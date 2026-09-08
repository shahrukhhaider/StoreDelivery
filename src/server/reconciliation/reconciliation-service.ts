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
import { fetchShopifyIdentityIndex } from "../shopify/duplicate-detector.js";
import { classifyProducts, type ClassifyProductsInput } from "../../engine/reconciliation/reconciliation-engine.js";
import { computeProductFingerprint } from "../../engine/reconciliation/product-fingerprint.js";
import { computeProductDiff } from "../../engine/reconciliation/diff-engine.js";
import { computeVariantFingerprint } from "../../engine/sku/variant-fingerprint.js";
import type { CatalogProduct } from "@shared/types/catalog.js";
import type {
  ProductClassification,
  ReconciliationSummary,
  PersistedProductMapping,
  ShopifyIdentityIndex,
  ProductDiff,
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
  /** Product diffs for UPDATE_REVIEW items (empty for non-update runs) */
  diffs: ProductDiff[];
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

  // Step 3: Fetch Shopify identity index from live API
  // Shopify is the source of truth — always query live to avoid stale data.
  // The GraphQL client handles rate limiting and staggered retries.
  logger.info("Fetching Shopify identity index from live API", { shopId });
  const shopifyIndex: ShopifyIdentityIndex = await fetchShopifyIdentityIndex(client);

  logger.info("Shopify identity index loaded", {
    shopId,
    skus: shopifyIndex.skus.size,
    barcodes: shopifyIndex.barcodes.size,
    titles: shopifyIndex.titles.size,
  });

  // Step 4: Classify via pure engine
  const { classifications, summary } = classifyProducts({
    products,
    existingMappings,
    shopifyIndex,
  });

  // Step 5: For EXISTING_MAPPED products, classify as NO_CHANGE for now.
  // Diffs will be computed on-demand from the live Shopify API when the
  // merchant opens the update review page — not during import.
  const diffs: ProductDiff[] = [];
  const finalClassifications = classifications.map((c) => {
    if (c.classification === "EXISTING_MAPPED") {
      return {
        ...c,
        classification: "NO_CHANGE" as const,
        proposedAction: "NO_CHANGE" as const,
      };
    }
    return c;
  });

  const finalSummary = {
    totalProducts: finalClassifications.length,
    existingMapped: finalClassifications.filter((c) => c.classification === "EXISTING_MAPPED").length,
    likelyExisting: finalClassifications.filter((c) => c.classification === "LIKELY_EXISTING").length,
    newProducts: finalClassifications.filter((c) => c.classification === "NEW_PRODUCT").length,
    needsReview: finalClassifications.filter((c) => c.classification === "NEEDS_REVIEW").length,
    noChange: finalClassifications.filter((c) => c.classification === "NO_CHANGE").length,
  };

  // Step 6: Create CatalogRun + RunItems
  const catalogRun = await prisma.catalogRun.create({
    data: {
      supplierProfileId: profile.id,
      shopId,
      catalogId,
      schemaFingerprint,
      status: "COMPLETED",
      totalProducts: finalSummary.totalProducts,
      mappedCount: finalSummary.existingMapped,
      matchedCount: finalSummary.likelyExisting,
      newCount: finalSummary.newProducts,
      reviewCount: finalSummary.needsReview,
      completedAt: new Date(),
    },
  });

  // Batch-insert run items
  if (finalClassifications.length > 0) {
    await prisma.runItem.createMany({
      data: finalClassifications.map((c) => ({
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
  const mappedKeys = finalClassifications
    .filter((c) => (c.classification === "EXISTING_MAPPED" || c.classification === "UPDATE_REVIEW" || c.classification === "NO_CHANGE") && c.productMappingId)
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
    classifications: finalClassifications,
    summary: finalSummary,
    diffs,
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
