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

    // Reuse recent reconciliation if available (avoids duplicate run when merchant
    // already used the Updates tab which ran reconciliation within the last 15 minutes)
    const recentRun = await prisma.catalogRun.findFirst({
      where: {
        catalogId: operation.catalogId,
        shopId: operation.shopId,
        status: "COMPLETED",
        completedAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
      },
      orderBy: { completedAt: "desc" },
      include: {
        items: {
          select: { sourceProductKey: true, classification: true, proposedAction: true },
        },
      },
    });

    logger.info(
      recentRun ? "Reusing recent reconciliation run" : "Running fresh reconciliation",
      { productCount: catalogProducts.length, recentRunId: recentRun?.id },
    );

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

    // Determine which products to import vs skip vs update based on classification
    // NEW_PRODUCT → create, UPDATE_REVIEW → update (deferred to merchant review),
    // EXISTING_MAPPED/NO_CHANGE → skip, LIKELY_EXISTING → skip,
    // NEEDS_REVIEW → skip (hold for merchant)
    const toCreateKeys = new Set<string>();
    const toSkipKeys = new Set<string>();

    for (const c of reconciliation.classifications) {
      if (c.classification === "NEW_PRODUCT") {
        toCreateKeys.add(c.sourceProductKey);
      } else {
        // EXISTING_MAPPED, LIKELY_EXISTING, NEEDS_REVIEW, NO_CHANGE, UPDATE_REVIEW → skip
        // UPDATE_REVIEW products are handled via the separate update review API,
        // not during the initial import execution.
        toSkipKeys.add(c.sourceProductKey);
      }
    }

    const toImport = catalogProducts.filter((p) => toCreateKeys.has(p.sourceKey));
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
            await persistReconciliationMappings(
              operation.shopId,
              reconciliation.supplierProfileId,
              product,
              result,
            );
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
