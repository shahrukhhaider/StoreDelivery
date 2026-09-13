/**
 * Import Executor — Sections 13-15
 *
 * Orchestrates the full import: load plan → detect duplicates →
 * create import items → write to Shopify in batches → track results.
 * Resumable: skips already-succeeded items on restart.
 */

import { getPrisma } from "../db.js";
import { getLogger } from "../logger.js";
import { ShopifyGraphQLClient } from "../shopify/graphql-client.js";
import { getAccessToken } from "../shopify/auth.js";
import { writeProducts, getPrimaryLocationId, type WriteResult } from "../shopify/writer.js";
import { persistVariantMappings } from "../shopify/variant-mapping.js";
import { runReconciliation, persistReconciliationMappings } from "../reconciliation/reconciliation-service.js";
import type { CatalogProduct } from "@shared/types/catalog.js";

/**
 * Execute an import operation end-to-end.
 */
export async function executeImport(operationId: string): Promise<void> {
  const prisma = getPrisma();
  const logger = getLogger();

  // Load operation
  const operation = await prisma.importOperation.findUnique({
    where: { id: operationId },
    include: {
      shop: true,
      catalog: {
        include: {
          upload: { select: { uploadMode: true } },
          vendor: { select: { id: true, normalizedName: true } },
        },
      },
    },
  });

  if (!operation) {
    throw new Error(`Import operation ${operationId} not found`);
  }

  if (operation.status !== "planned" && operation.status !== "in_progress") {
    throw new Error(`Operation ${operationId} is in status ${operation.status}, cannot execute`);
  }

  // Mark as in_progress
  await prisma.importOperation.update({
    where: { id: operationId },
    data: { status: "in_progress" },
  });

  logger.info("Starting import execution", {
    operationId,
    shopDomain: operation.shop.shopDomain,
    catalogId: operation.catalogId,
  });

  try {
    // Get access token
    const accessToken = await getAccessToken(operation.shop.shopDomain);
    if (!accessToken) {
      throw new Error(`No access token for shop ${operation.shop.shopDomain}`);
    }

    const client = new ShopifyGraphQLClient({
      shopDomain: operation.shop.shopDomain,
      accessToken,
    });

    // Load catalog products (ready + needs_review)
    const dbProducts = await prisma.catalogProduct.findMany({
      where: {
        catalogId: operation.catalogId,
        status: { in: ["ready", "needs_review"] },
      },
    });

    // Load overrides and apply to get resolved products (final state)
    const overrides = await prisma.catalogOverride.findMany({
      where: { catalogId: operation.catalogId },
    });
    const overridesByProduct = new Map<string, Array<{ field: string; oldValue: unknown; newValue: unknown; source: string }>>();
    for (const o of overrides) {
      const list = overridesByProduct.get(o.productId) ?? [];
      list.push({ field: o.field, oldValue: o.oldValue, newValue: o.newValue, source: o.source });
      overridesByProduct.set(o.productId, list);
    }

    const { applyOverrides } = await import("../../engine/overrides/merge.js");
    const catalogProducts: CatalogProduct[] = dbProducts.map((p) => {
      const source = p.normalizedJson as unknown as CatalogProduct;
      const productOverrides = (overridesByProduct.get(p.id) ?? []).map((o) => ({
        field: o.field,
        oldValue: o.oldValue,
        newValue: o.newValue,
        source: o.source as "user" | "bulk_rule" | "auto_fix",
      }));
      return applyOverrides(source, productOverrides);
    });

    // Reconciliation — classify products against persisted mappings + Shopify
    const catalog = operation.catalog;
    const schemaFingerprint = catalog.schemaFingerprint ?? "unknown";

    // Use the most recent completed CatalogRun for this catalog.
    // The merchant already reviewed reconciliation results on the edit page —
    // there is no need to re-run it at import time. Running it again can
    // produce different results (e.g. Shopify state changed) that the merchant
    // never reviewed, leading to unexpected creates/skips.
    //
    // Only fall back to a fresh reconciliation if no prior run exists
    // (e.g. merchant skipped the edit page and went straight to import).
    const recentRun = await prisma.catalogRun.findFirst({
      where: {
        catalogId: operation.catalogId,
        shopId: operation.shopId,
        status: "COMPLETED",
      },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        supplierProfileId: true,
        items: {
          select: { sourceProductKey: true, classification: true, proposedAction: true },
        },
      },
    });

    // Build classifications from the existing run, or run fresh if none exists
    let classifications: Array<{ sourceProductKey: string; classification: string }>;
    let supplierProfileId: string | null = recentRun?.supplierProfileId ?? null;

    if (recentRun) {
      logger.info("Using existing reconciliation run — skipping fresh reconciliation", {
        catalogRunId: recentRun.id,
        itemCount: recentRun.items.length,
      });
      classifications = recentRun.items;
    } else {
      logger.info("No prior reconciliation run found — running fresh reconciliation", {
        productCount: catalogProducts.length,
      });
      const reconciliation = await runReconciliation(
        operation.shopId,
        operation.catalogId,
        schemaFingerprint,
        catalogProducts,
        client,
        operation.catalog.upload?.uploadMode ?? "CATALOG_UPDATE",
        operation.catalog.vendor?.id ?? null,
      );
      logger.info("Reconciliation complete", {
        summary: reconciliation.summary,
        catalogRunId: reconciliation.catalogRunId,
      });
      classifications = reconciliation.classifications.map((c) => ({
        sourceProductKey: c.sourceProductKey,
        classification: c.classification,
      }));
      supplierProfileId = reconciliation.supplierProfileId;
    }

    // Determine which products to import vs skip vs update based on classification
    // NEW_PRODUCT → create
    // UPDATE_REVIEW → update existing Shopify product via applyProductUpdate
    // EXISTING_MAPPED/NO_CHANGE/LIKELY_EXISTING/NEEDS_REVIEW → skip
    const toCreateKeys = new Set<string>();
    const toUpdateKeys = new Set<string>();
    const toSkipKeys = new Set<string>();

    for (const c of classifications) {
      if (c.classification === "NEW_PRODUCT") {
        toCreateKeys.add(c.sourceProductKey);
      } else if (c.classification === "UPDATE_REVIEW") {
        toUpdateKeys.add(c.sourceProductKey);
      } else {
        toSkipKeys.add(c.sourceProductKey);
      }
    }

    const toImport = catalogProducts.filter((p) => toCreateKeys.has(p.sourceKey));
    const toUpdate = catalogProducts.filter((p) => toUpdateKeys.has(p.sourceKey));
    const toSkip = catalogProducts.filter((p) => toSkipKeys.has(p.sourceKey));

    // Check for existing import items (resumability)
    const existingItems = await prisma.importItem.findMany({
      where: { importOperationId: operationId },
      select: { sourceProductKey: true, status: true },
    });
    const completedKeys = new Set(
      existingItems.filter((i) => i.status === "success").map((i) => i.sourceProductKey),
    );

    // Create import items for products that don't already have records
    const existingKeys = new Set(existingItems.map((i) => i.sourceProductKey));

    const newItems = [
      ...toImport
        .filter((p) => !existingKeys.has(p.sourceKey))
        .map((p) => ({
          importOperationId: operationId,
          sourceProductKey: p.sourceKey,
          action: "create" as const,
          status: "pending" as const,
        })),
      ...toUpdate
        .filter((p) => !existingKeys.has(p.sourceKey))
        .map((p) => ({
          importOperationId: operationId,
          sourceProductKey: p.sourceKey,
          action: "update" as const,
          status: "pending" as const,
        })),
      ...toSkip
        .filter((p) => !existingKeys.has(p.sourceKey))
        .map((p) => ({
          importOperationId: operationId,
          sourceProductKey: p.sourceKey,
          action: "skip" as const,
          status: "skipped" as const,
        })),
    ];

    if (newItems.length > 0) {
      await prisma.importItem.createMany({ data: newItems });
    }

    // Update skipped count
    await prisma.importOperation.update({
      where: { id: operationId },
      data: { skippedCount: toSkip.length },
    });

    // Filter out already-completed products
    const productsToWrite = toImport.filter((p) => !completedKeys.has(p.sourceKey));

    logger.info("Starting Shopify writes", {
      total: toImport.length,
      alreadyCompleted: completedKeys.size,
      toWrite: productsToWrite.length,
      skipped: toSkip.length,
    });

    // Fetch primary location for inventory
    const locationId = await getPrimaryLocationId(client, operation.shop.shopDomain);

    // Build product lookup map for onItemComplete callback
    const productBySourceKey = new Map<string, CatalogProduct>();
    for (const p of productsToWrite) {
      productBySourceKey.set(p.sourceKey, p);
    }

    // Write products
    let successCount = existingItems.filter((i) => i.status === "success").length;
    let failedCount = existingItems.filter((i) => i.status === "failed").length;

    const results = await writeProducts(client, productsToWrite, {
      locationId,
      shopDomain: operation.shop.shopDomain,
      vendorProfileId: operation.catalog.vendor?.id ?? null,
      vendorNormalizedName: operation.catalog.vendor?.normalizedName ?? null,
      onItemComplete: async (result: WriteResult) => {
        // Update import item in DB
        await prisma.importItem.updateMany({
          where: {
            importOperationId: operationId,
            sourceProductKey: result.sourceKey,
          },
          data: {
            status: result.success ? "success" : "failed",
            shopifyProductId: result.shopifyProductId ?? null,
            errorCode: result.errorCode ?? null,
            errorMessage: result.errorMessage ?? null,
          },
        });

        if (result.success) {
          successCount++;

          // Persist variant mappings after successful Shopify write
          // (spec: persist only after mutation succeeds)
          const product = productBySourceKey.get(result.sourceKey);
          if (product) {
            await persistVariantMappings(operation.shopId, product, result);
            // Also persist reconciliation-level product + variant mappings
            if (supplierProfileId) {
              await persistReconciliationMappings(
                operation.shopId,
                supplierProfileId,
                product,
                result,
              );
            }
          }
        } else {
          failedCount++;
        }

        // Update operation counters
        await prisma.importOperation.update({
          where: { id: operationId },
          data: { successCount, failedCount },
        });
      },
    });

    // Apply updates to existing products (UPDATE_REVIEW)
    if (toUpdate.length > 0) {
      logger.info("Applying updates to existing Shopify products", { count: toUpdate.length });

      const { runReconciliation: _r, ...rest } = await import("../reconciliation/reconciliation-service.js").then(m => m);
      const { fetchProductDetails } = await import("../shopify/product-detail-fetcher.js");
      const { computeProductDiff } = await import("../../engine/reconciliation/diff-engine.js");
      const { applyProductUpdate } = await import("../shopify/update-writer.js");

      // Get the latest run to find shopify product IDs for UPDATE_REVIEW items
      const latestRun = await prisma.catalogRun.findFirst({
        where: { catalogId: operation.catalogId },
        orderBy: { completedAt: "desc" },
        include: {
          items: {
            where: { classification: "UPDATE_REVIEW" },
            select: { sourceProductKey: true, matchedShopifyId: true, productMappingId: true },
          },
        },
      });

      const runItemByKey = new Map(
        (latestRun?.items ?? []).map((i) => [i.sourceProductKey, i]),
      );

      // Fetch live Shopify details for all UPDATE_REVIEW products
      const shopifyIds = [...new Set(
        [...runItemByKey.values()]
          .map((i) => i.matchedShopifyId)
          .filter((id): id is string => !!id),
      )];

      const liveDetails = shopifyIds.length > 0
        ? await fetchProductDetails(client, shopifyIds)
        : new Map();

      const productByKey = new Map(toUpdate.map((p) => [p.sourceKey, p]));

      for (const sourceKey of toUpdateKeys) {
        const runItem = runItemByKey.get(sourceKey);
        const supplierProduct = productByKey.get(sourceKey);
        if (!runItem?.matchedShopifyId || !supplierProduct) {
          await prisma.importItem.updateMany({
            where: { importOperationId: operationId, sourceProductKey: sourceKey },
            data: { status: "failed", errorCode: "MISSING_DATA" },
          });
          failedCount++;
          continue;
        }

        const liveDetail = liveDetails.get(runItem.matchedShopifyId);
        if (!liveDetail) {
          await prisma.importItem.updateMany({
            where: { importOperationId: operationId, sourceProductKey: sourceKey },
            data: { status: "failed", errorCode: "SHOPIFY_DETAIL_MISSING" },
          });
          failedCount++;
          continue;
        }

        // Load variant mappings
        const productMapping = runItem.productMappingId
          ? await prisma.productMapping.findUnique({
              where: { id: runItem.productMappingId },
              include: { variantMappings: true },
            })
          : null;

        const variantMappings = (productMapping?.variantMappings ?? []).map((v) => ({
          id: v.id,
          sourceVariantKey: v.sourceVariantKey,
          sourceVariantFingerprint: v.sourceVariantFingerprint,
          shopifyVariantId: v.shopifyVariantId,
          sourceSku: v.sourceSku,
          barcode: v.barcode,
          shopifySku: v.shopifySku,
          skuSource: v.skuSource,
        }));

        const diff = computeProductDiff(supplierProduct, liveDetail.product, liveDetail.variants, variantMappings);

        // Build inventoryItemIds map
        const inventoryItemIds = new Map<string, string>();
        for (const v of liveDetail.variants) {
          if (v.shopifyVariantId && v.inventoryItemId) {
            inventoryItemIds.set(v.shopifyVariantId, v.inventoryItemId);
          }
        }

        const productChanges = diff.productChanges.map((c) => ({ ...c, selected: true }));
        const variantChanges = diff.variantChanges.map((v) => ({
          ...v,
          changes: v.changes.map((c) => ({ ...c, selected: true })),
        }));

        const updateResult = await applyProductUpdate(client, {
          shopifyProductId: runItem.matchedShopifyId,
          sourceProductKey: sourceKey,
          shopId: operation.shopId,
          shopDomain: operation.shop.shopDomain,
          supplierProduct,
          productChanges,
          variantChanges,
          inventoryItemIds,
        });

        await prisma.importItem.updateMany({
          where: { importOperationId: operationId, sourceProductKey: sourceKey },
          data: {
            status: updateResult.success ? "success" : "failed",
            shopifyProductId: runItem.matchedShopifyId,
            errorCode: updateResult.errorCode ?? null,
            errorMessage: updateResult.errorMessage ?? null,
          },
        });

        if (updateResult.success) {
          successCount++;
        } else {
          failedCount++;
        }

        await prisma.importOperation.update({
          where: { id: operationId },
          data: { successCount, failedCount },
        });
      }

      logger.info("Updates applied", {
        operationId,
        total: toUpdate.length,
        success: successCount,
        failed: failedCount,
      });
    }

    // Mark operation as completed
    const finalStatus = failedCount > 0 && successCount === 0 ? "failed" : "completed";
    await prisma.importOperation.update({
      where: { id: operationId },
      data: {
        status: finalStatus,
        successCount,
        failedCount,
        completedAt: new Date(),
      },
    });

    // Create import snapshot (permanent record for future rollback)
    const allOverrides = await prisma.catalogOverride.findMany({
      where: { catalogId: operation.catalogId },
    });
    if (allOverrides.length > 0) {
      await prisma.importSnapshot.create({
        data: {
          importOperationId: operationId,
          catalogId: operation.catalogId,
          appliedOverrides: allOverrides.map((o) => ({
            productId: o.productId,
            field: o.field,
            oldValue: o.oldValue,
            newValue: o.newValue,
            source: o.source,
          })),
          resolvedProductCount: toImport.length,
        },
      });

      // Clean up temporary overrides (edits are now snapshotted)
      await prisma.catalogOverride.deleteMany({
        where: { catalogId: operation.catalogId },
      });

      logger.info("Import snapshot created, overrides cleaned up", {
        operationId,
        overrideCount: allOverrides.length,
      });
    }

    logger.info("Import execution complete", {
      operationId,
      status: finalStatus,
      successCount,
      failedCount,
      skippedCount: toSkip.length,
    });

    // Save vendor column mappings after a successful Catalog Update.
    // Inventory Updates reuse the mapping but never overwrite it.
    if (finalStatus === "completed" &&
        (operation.catalog.upload?.uploadMode ?? "CATALOG_UPDATE") === "CATALOG_UPDATE") {
      await saveVendorColumnMappings(operation.catalogId, logger, prisma);
    }
  } catch (err) {
    logger.error("Import execution failed", {
      operationId,
      error: (err as Error).message,
      stack: (err as Error).stack,
    });

    await prisma.importOperation.update({
      where: { id: operationId },
      data: { status: "failed" },
    });

    throw err;
  }
}

/**
 * Retry only failed items in an import operation.
 */
export async function retryFailedItems(operationId: string): Promise<void> {
  const prisma = getPrisma();
  const logger = getLogger();

  const operation = await prisma.importOperation.findUnique({
    where: { id: operationId },
    include: {
      shop: true,
      catalog: { include: { vendor: { select: { id: true, normalizedName: true } } } },
    },
  });

  if (!operation) {
    throw new Error(`Operation ${operationId} not found`);
  }

  // Get failed items
  const failedItems = await prisma.importItem.findMany({
    where: { importOperationId: operationId, status: "failed" },
  });

  if (failedItems.length === 0) {
    logger.info("No failed items to retry", { operationId });
    return;
  }

  // Get access token
  const accessToken = await getAccessToken(operation.shop.shopDomain);
  if (!accessToken) {
    throw new Error(`No access token for shop ${operation.shop.shopDomain}`);
  }

  const client = new ShopifyGraphQLClient({
    shopDomain: operation.shop.shopDomain,
    accessToken,
  });

  // Load catalog products for failed items
  const failedKeys = new Set(failedItems.map((i) => i.sourceProductKey));
  const dbProducts = await prisma.catalogProduct.findMany({
    where: { catalogId: operation.catalogId },
  });
  const productsToRetry = dbProducts
    .filter((p) => failedKeys.has(p.sourceKey))
    .map((p) => p.normalizedJson as unknown as CatalogProduct);

  // Resolve supplier profile for reconciliation mapping persistence
  const catalog = await prisma.catalog.findUnique({
    where: { id: operation.catalogId },
    select: { schemaFingerprint: true },
  });
  const supplierProfile = catalog
    ? await prisma.supplierProfile.findFirst({
        where: {
          shopId: operation.shopId,
          schemaFingerprint: catalog.schemaFingerprint,
        },
        select: { id: true },
      })
    : null;

  // Reset failed items to pending
  await prisma.importItem.updateMany({
    where: { importOperationId: operationId, status: "failed" },
    data: { status: "pending", errorCode: null, errorMessage: null },
  });

  // Mark operation as in_progress
  await prisma.importOperation.update({
    where: { id: operationId },
    data: { status: "in_progress", completedAt: null },
  });

  logger.info("Retrying failed items", {
    operationId,
    count: productsToRetry.length,
  });

  let successCount = operation.successCount;
  let failedCount = 0;

  const locationId = await getPrimaryLocationId(client, operation.shop.shopDomain);

  // Build product lookup map for onItemComplete callback
  const retryProductBySourceKey = new Map<string, CatalogProduct>();
  for (const p of productsToRetry) {
    retryProductBySourceKey.set(p.sourceKey, p);
  }

  await writeProducts(client, productsToRetry, {
    locationId,
    shopDomain: operation.shop.shopDomain,
    vendorProfileId: operation.catalog?.vendor?.id ?? null,
    vendorNormalizedName: operation.catalog?.vendor?.normalizedName ?? null,
    onItemComplete: async (result: WriteResult) => {
      await prisma.importItem.updateMany({
        where: {
          importOperationId: operationId,
          sourceProductKey: result.sourceKey,
        },
        data: {
          status: result.success ? "success" : "failed",
          shopifyProductId: result.shopifyProductId ?? null,
          errorCode: result.errorCode ?? null,
          errorMessage: result.errorMessage ?? null,
        },
      });

      if (result.success) {
        successCount++;

        // Persist variant mappings on retry success (idempotent upsert)
        const product = retryProductBySourceKey.get(result.sourceKey);
        if (product) {
          await persistVariantMappings(operation.shopId, product, result);
          // Also persist reconciliation-level mappings if supplier profile exists
          if (supplierProfile) {
            await persistReconciliationMappings(
              operation.shopId,
              supplierProfile.id,
              product,
              result,
            );
          }
        }
      } else {
        failedCount++;
      }

      await prisma.importOperation.update({
        where: { id: operationId },
        data: { successCount, failedCount },
      });
    },
  });

  const finalStatus = failedCount > 0 && successCount === 0 ? "failed" : "completed";
  await prisma.importOperation.update({
    where: { id: operationId },
    data: { status: finalStatus, failedCount, completedAt: new Date() },
  });

  logger.info("Retry complete", { operationId, successCount, failedCount });
}

// ---------------------------------------------------------------------------
// Save vendor column mappings after successful import
// ---------------------------------------------------------------------------

/**
 * After a successful Catalog Update, persist the catalog's confirmed FieldMapping
 * records as VendorColumnMapping for the catalog's resolved vendor.
 *
 * This enables subsequent uploads from the same vendor to pre-load the correct
 * column mapping automatically instead of starting from scratch.
 */
async function saveVendorColumnMappings(
  catalogId: string,
  logger: ReturnType<typeof getLogger>,
  prisma: ReturnType<typeof import("../db.js").getPrisma>,
): Promise<void> {
  try {
    // Load the catalog's vendor assignment
    const catalog = await prisma.catalog.findUnique({
      where: { id: catalogId },
      select: { vendorId: true },
    });

    if (!catalog?.vendorId) {
      // No vendor assigned — nothing to persist
      return;
    }

    const vendorId = catalog.vendorId;

    // Load confirmed field mappings for this catalog
    const fieldMappings = await prisma.fieldMapping.findMany({
      where: { catalogId, ignored: false },
    });

    if (fieldMappings.length === 0) return;

    // Upsert each as a VendorColumnMapping — overwrites any previous mapping
    // for this vendor so the latest confirmed schema is always current.
    let saved = 0;
    for (const fm of fieldMappings) {
      await prisma.vendorColumnMapping.upsert({
        where: { vendorId_sourceColumn: { vendorId, sourceColumn: fm.sourceColumn } },
        create: {
          vendorId,
          sourceColumn: fm.sourceColumn,
          canonicalField: fm.targetField,
          ignored: false,
        },
        update: {
          canonicalField: fm.targetField,
          ignored: false,
        },
      });
      saved++;
    }

    // Also update the vendor's schemaFingerprint to the current catalog's fingerprint
    const catalogWithFingerprint = await prisma.catalog.findUnique({
      where: { id: catalogId },
      select: { schemaFingerprint: true },
    });
    if (catalogWithFingerprint?.schemaFingerprint) {
      await prisma.supplierProfile.update({
        where: { id: vendorId },
        data: { schemaFingerprint: catalogWithFingerprint.schemaFingerprint },
      });
    }

    logger.info("Vendor column mappings saved after successful import", {
      catalogId,
      vendorId,
      mappingCount: saved,
    });
  } catch (err) {
    // Non-fatal — log but don't fail the import over mapping persistence
    logger.error("Failed to save vendor column mappings", {
      catalogId,
      error: (err as Error).message,
    });
  }
}
