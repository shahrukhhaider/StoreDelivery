/**
 * Reconciliation Service — orchestrates the full reconciliation flow.
 *
 * Supplier file → resolve SupplierProfile → load persisted mappings
 * → fetch Shopify identifiers → classify → create CatalogRun + RunItems
 * → return summary.
 *
 * Also provides: persistProductMapping(), linkExistingProduct(),
 * confirmCandidateMatch().
 */

import { getPrisma } from "../db.js";
import { getLogger } from "../logger.js";
import { ShopifyGraphQLClient } from "../shopify/graphql-client.js";
import { buildIdentityIndexFromSnapshots, hasReadySnapshot } from "../shopify/catalog-sync.js";
import { classifyProducts, type ClassifyProductsInput } from "../../engine/reconciliation/reconciliation-engine.js";
import { computeProductFingerprint } from "../../engine/reconciliation/product-fingerprint.js";
import { computeVariantFingerprint } from "../../engine/sku/variant-fingerprint.js";
import type { CatalogProduct } from "@shared/types/catalog.js";
import type {
  ProductClassification,
  ReconciliationSummary,
  PersistedProductMapping,
  ShopifyIdentityIndex,
} from "@shared/types/reconciliation.js";
import type { WriteResult } from "../shopify/writer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReconciliationResult = {
  catalogRunId: string;
  supplierProfileId: string;
  classifications: ProductClassification[];
  summary: ReconciliationSummary;
};

// ---------------------------------------------------------------------------
// Main: run reconciliation for a catalog
// ---------------------------------------------------------------------------

/**
 * Run reconciliation against a catalog's products.
 *
 * Steps:
 *   1. Resolve or create SupplierProfile from schemaFingerprint
 *   2. Load persisted ProductMappings for this profile
 *   3. Fetch Shopify identity index
 *   4. Classify products via pure engine
 *   5. Create CatalogRun + RunItems
 *   6. Return summary
 */
export async function runReconciliation(
  shopId: string,
  catalogId: string,
  schemaFingerprint: string,
  products: CatalogProduct[],
  client: ShopifyGraphQLClient,
): Promise<ReconciliationResult> {
  const prisma = getPrisma();
  const logger = getLogger();

  // Step 1: Resolve or create SupplierProfile
  const profile = await resolveSupplierProfile(shopId, schemaFingerprint);

  logger.info("Reconciliation started", {
    shopId,
    catalogId,
    supplierProfileId: profile.id,
    productCount: products.length,
  });

  // Step 2: Load persisted ProductMappings
  const existingMappings = await loadProductMappings(profile.id);

  logger.info("Loaded persisted mappings", {
    supplierProfileId: profile.id,
    mappingCount: existingMappings.size,
  });

  // Step 3: Build Shopify identity index from local snapshots
  // Hard invariant: unmapped products must not be classified as NEW_PRODUCT
  // unless StoreDelivery has a valid Shopify catalog snapshot.
  const snapshotReady = await hasReadySnapshot(shopId);
  if (!snapshotReady) {
    logger.warn("No valid Shopify catalog snapshot — new product classification will be blocked", { shopId });
  }

  const shopifyIndex: ShopifyIdentityIndex = snapshotReady
    ? await buildIdentityIndexFromSnapshots(shopId)
    : { skus: new Map(), barcodes: new Map(), titles: new Map() };

  // Step 4: Classify via pure engine
  let { classifications, summary } = classifyProducts({
    products,
    existingMappings,
    shopifyIndex,
  });

  // Reconciliation guard: if no valid snapshot, downgrade NEW_PRODUCT to NEEDS_REVIEW
  // An unmapped supplier product must not be classified as NEW_PRODUCT unless
  // StoreDelivery has a valid Shopify catalog snapshot.
  if (!snapshotReady) {
    let downgraded = 0;
    classifications = classifications.map((c) => {
      if (c.classification === "NEW_PRODUCT") {
        downgraded++;
        return {
          ...c,
          classification: "NEEDS_REVIEW" as const,
          proposedAction: "SKIP" as const,
          confidence: null,
          matchEvidence: [{
            type: "persisted_mapping" as const,
            sourceValue: "NO_SHOPIFY_SNAPSHOT",
            confidence: "LOW" as const,
          }],
        };
      }
      return c;
    });

    if (downgraded > 0) {
      // Recompute summary
      summary = {
        totalProducts: classifications.length,
        existingMapped: classifications.filter((c) => c.classification === "EXISTING_MAPPED").length,
        likelyExisting: classifications.filter((c) => c.classification === "LIKELY_EXISTING").length,
        newProducts: classifications.filter((c) => c.classification === "NEW_PRODUCT").length,
        needsReview: classifications.filter((c) => c.classification === "NEEDS_REVIEW").length,
        noChange: classifications.filter((c) => c.classification === "NO_CHANGE").length,
      };

      logger.warn("Downgraded NEW_PRODUCT classifications due to missing snapshot", {
        downgraded,
        newSummary: summary,
      });
    }
  }

  // Step 5: Create CatalogRun + RunItems
  const catalogRun = await prisma.catalogRun.create({
    data: {
      supplierProfileId: profile.id,
      shopId,
      catalogId,
      schemaFingerprint,
      status: "COMPLETED",
      totalProducts: summary.totalProducts,
      mappedCount: summary.existingMapped,
      matchedCount: summary.likelyExisting,
      newCount: summary.newProducts,
      reviewCount: summary.needsReview,
      completedAt: new Date(),
    },
  });

  // Batch-insert run items
  if (classifications.length > 0) {
    await prisma.runItem.createMany({
      data: classifications.map((c) => ({
        catalogRunId: catalogRun.id,
        sourceProductKey: c.sourceProductKey,
        classification: c.classification as never,
        proposedAction: c.proposedAction as never,
        productMappingId: c.productMappingId,
        matchedShopifyId: c.matchedShopifyProductId,
        confidence: c.confidence as never ?? undefined,
        matchEvidence: c.matchEvidence.length > 0 ? (c.matchEvidence as never) : undefined,
      })),
    });
  }

  // Update lastSeenAt for mapped products
  const mappedKeys = classifications
    .filter((c) => c.classification === "EXISTING_MAPPED" && c.productMappingId)
    .map((c) => c.productMappingId!);

  if (mappedKeys.length > 0) {
    await prisma.productMapping.updateMany({
      where: { id: { in: mappedKeys } },
      data: { lastSeenAt: new Date() },
    });
  }

  logger.info("Reconciliation complete", {
    catalogRunId: catalogRun.id,
    summary,
  });

  return {
    catalogRunId: catalogRun.id,
    supplierProfileId: profile.id,
    classifications,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Persist product + variant mappings after successful Shopify write
// ---------------------------------------------------------------------------

/**
 * Persist product and variant mappings after a successful Shopify create.
 * Called from the import executor after each product write.
 */
export async function persistReconciliationMappings(
  shopId: string,
  supplierProfileId: string,
  product: CatalogProduct,
  writeResult: WriteResult,
): Promise<void> {
  if (!writeResult.success || !writeResult.shopifyProductId) return;

  const prisma = getPrisma();
  const logger = getLogger();

  const productFingerprint = computeProductFingerprint(product);

  try {
    // Upsert ProductMapping
    const productMapping = await prisma.productMapping.upsert({
      where: {
        supplierProfileId_sourceProductKey: {
          supplierProfileId,
          sourceProductKey: product.sourceKey,
        },
      },
      create: {
        shopId,
        supplierProfileId,
        sourceProductKey: product.sourceKey,
        sourceProductFingerprint: productFingerprint,
        shopifyProductId: writeResult.shopifyProductId,
        mappingStatus: "MAPPED",
        matchMethod: "create",
        confidence: "HIGH",
        lastSeenAt: new Date(),
      },
      update: {
        shopifyProductId: writeResult.shopifyProductId,
        mappingStatus: "MAPPED",
        matchMethod: "create",
        confidence: "HIGH",
        lastSeenAt: new Date(),
      },
    });

    // Upsert VariantMappings
    const variantMappings = writeResult.variantMappings ?? [];
    for (let i = 0; i < product.variants.length; i++) {
      const variant = product.variants[i];
      const shopifyMapping = variantMappings[i];
      if (!shopifyMapping) continue;

      const variantFingerprint = computeVariantFingerprint(product.sourceKey, variant, i);

      await prisma.variantMapping.upsert({
        where: {
          productMappingId_sourceVariantFingerprint: {
            productMappingId: productMapping.id,
            sourceVariantFingerprint: variantFingerprint,
          },
        },
        create: {
          productMappingId: productMapping.id,
          sourceVariantKey: variant.sourceKey,
          sourceVariantFingerprint: variantFingerprint,
          sourceSku: variant.sku?.trim() || null,
          barcode: variant.barcode?.trim() || null,
          shopifyVariantId: shopifyMapping.shopifyVariantId,
          shopifySku: shopifyMapping.shopifySku,
          skuSource: resolveSkuSource(variant),
          matchMethod: "create",
          confidence: "HIGH",
          lastSeenAt: new Date(),
        },
        update: {
          sourceVariantKey: variant.sourceKey,
          shopifyVariantId: shopifyMapping.shopifyVariantId,
          shopifySku: shopifyMapping.shopifySku,
          sourceSku: variant.sku?.trim() || null,
          barcode: variant.barcode?.trim() || null,
          skuSource: resolveSkuSource(variant),
          lastSeenAt: new Date(),
        },
      });
    }

    logger.debug("Reconciliation mappings persisted", {
      productSourceKey: product.sourceKey,
      productMappingId: productMapping.id,
      variantCount: product.variants.length,
    });
  } catch (err) {
    logger.error("Failed to persist reconciliation mappings", {
      productSourceKey: product.sourceKey,
      error: (err as Error).message,
    });
  }
}

// ---------------------------------------------------------------------------
// Link existing product (merchant confirms bootstrap match)
// ---------------------------------------------------------------------------

/**
 * Persist a mapping between a source product and an existing Shopify product.
 * No Shopify mutation required — this bootstraps reconciliation.
 */
export async function linkExistingProduct(
  shopId: string,
  supplierProfileId: string,
  sourceProductKey: string,
  shopifyProductId: string,
  matchMethod = "merchant_confirmed",
): Promise<string> {
  const prisma = getPrisma();

  const productMapping = await prisma.productMapping.upsert({
    where: {
      supplierProfileId_sourceProductKey: {
        supplierProfileId,
        sourceProductKey,
      },
    },
    create: {
      shopId,
      supplierProfileId,
      sourceProductKey,
      sourceProductFingerprint: sourceProductKey.toLowerCase().trim(),
      shopifyProductId,
      mappingStatus: "MAPPED",
      matchMethod,
      confidence: "HIGH",
      lastSeenAt: new Date(),
    },
    update: {
      shopifyProductId,
      mappingStatus: "MAPPED",
      matchMethod,
      confidence: "HIGH",
      lastSeenAt: new Date(),
    },
  });

  return productMapping.id;
}

// ---------------------------------------------------------------------------
// Confirm candidate matches from a reconciliation run
// ---------------------------------------------------------------------------

/**
 * Merchant confirms one or more candidate matches from a reconciliation run.
 * Persists ProductMapping without Shopify mutation.
 */
export async function confirmCandidateMatches(
  shopId: string,
  supplierProfileId: string,
  catalogRunId: string,
  sourceProductKeys: string[],
): Promise<{ confirmed: number }> {
  const prisma = getPrisma();
  const logger = getLogger();

  const runItems = await prisma.runItem.findMany({
    where: {
      catalogRunId,
      sourceProductKey: { in: sourceProductKeys },
      classification: { in: ["LIKELY_EXISTING", "NEEDS_REVIEW"] },
      merchantConfirmed: false,
    },
  });

  let confirmed = 0;
  for (const item of runItems) {
    if (!item.matchedShopifyId) continue;

    await linkExistingProduct(
      shopId,
      supplierProfileId,
      item.sourceProductKey,
      item.matchedShopifyId,
      "merchant_confirmed",
    );

    await prisma.runItem.update({
      where: { id: item.id },
      data: { merchantConfirmed: true },
    });

    confirmed++;
  }

  logger.info("Candidate matches confirmed", {
    catalogRunId,
    requested: sourceProductKeys.length,
    confirmed,
  });

  return { confirmed };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function resolveSupplierProfile(
  shopId: string,
  schemaFingerprint: string,
): Promise<{ id: string; name: string }> {
  const prisma = getPrisma();

  const existing = await prisma.supplierProfile.findUnique({
    where: {
      shopId_schemaFingerprint: { shopId, schemaFingerprint },
    },
    select: { id: true, name: true },
  });

  if (existing) return existing;

  const created = await prisma.supplierProfile.create({
    data: {
      shopId,
      name: `Supplier ${schemaFingerprint.slice(0, 8)}`,
      schemaFingerprint,
    },
    select: { id: true, name: true },
  });

  return created;
}

async function loadProductMappings(
  supplierProfileId: string,
): Promise<Map<string, PersistedProductMapping>> {
  const prisma = getPrisma();

  const mappings = await prisma.productMapping.findMany({
    where: { supplierProfileId },
    include: {
      variantMappings: {
        select: {
          id: true,
          sourceVariantKey: true,
          sourceVariantFingerprint: true,
          shopifyVariantId: true,
          sourceSku: true,
          barcode: true,
          shopifySku: true,
          skuSource: true,
        },
      },
    },
  });

  const result = new Map<string, PersistedProductMapping>();
  for (const m of mappings) {
    result.set(m.sourceProductKey, {
      id: m.id,
      sourceProductKey: m.sourceProductKey,
      sourceProductFingerprint: m.sourceProductFingerprint,
      shopifyProductId: m.shopifyProductId,
      mappingStatus: m.mappingStatus as PersistedProductMapping["mappingStatus"],
      variants: m.variantMappings.map((v) => ({
        id: v.id,
        sourceVariantKey: v.sourceVariantKey,
        sourceVariantFingerprint: v.sourceVariantFingerprint,
        shopifyVariantId: v.shopifyVariantId,
        sourceSku: v.sourceSku,
        barcode: v.barcode,
        shopifySku: v.shopifySku,
        skuSource: v.skuSource,
      })),
    });
  }

  return result;
}

function resolveSkuSource(
  variant: CatalogProduct["variants"][0],
): "SUPPLIER" | "MERCHANT" | "STOREDELIVERY_GENERATED" | "NONE" {
  if (variant.skuSource) return variant.skuSource;
  if (variant.sku && variant.sku.trim() !== "") return "SUPPLIER";
  return "NONE";
}
