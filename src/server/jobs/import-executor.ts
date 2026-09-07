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
import { fetchExistingIdentifiers, detectDuplicates } from "../shopify/duplicate-detector.js";
import { writeProducts, getPrimaryLocationId, type WriteResult } from "../shopify/writer.js";
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
    include: { shop: true, catalog: true },
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

    // Duplicate detection
    logger.info("Running duplicate detection", { productCount: catalogProducts.length });
    const existing = await fetchExistingIdentifiers(client);
    const duplicates = detectDuplicates(catalogProducts, existing);
    const duplicateKeys = new Set(duplicates.map((d) => d.sourceKey));

    logger.info("Duplicate detection complete", {
      total: catalogProducts.length,
      duplicates: duplicates.length,
    });

    // Determine which products to import vs skip
    const toImport = catalogProducts.filter((p) => !duplicateKeys.has(p.sourceKey));
    const toSkip = catalogProducts.filter((p) => duplicateKeys.has(p.sourceKey));

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

    // Write products
    let successCount = existingItems.filter((i) => i.status === "success").length;
    let failedCount = existingItems.filter((i) => i.status === "failed").length;

    const results = await writeProducts(client, productsToWrite, {
      locationId,
      shopDomain: operation.shop.shopDomain,
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
    include: { shop: true },
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

  await writeProducts(client, productsToRetry, {
    locationId,
    shopDomain: operation.shop.shopDomain,
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
