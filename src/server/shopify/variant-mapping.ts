/**
 * Variant Mapping Persistence Service
 *
 * Persists source→Shopify variant identity after successful writes.
 * Idempotent: upserts on retry (updates existing mapping, never duplicates).
 *
 * Spec invariant: a source variant can remain mapped to the same Shopify
 * variant even when its supplier SKU is missing, generated, changed, or
 * different from the Shopify SKU.
 */

import { getPrisma } from "../db.js";
import { getLogger } from "../logger.js";
import { computeVariantFingerprint } from "../../engine/sku/variant-fingerprint.js";
import type { CatalogProduct, SkuSource } from "@shared/types/catalog.js";
import type { WriteResult, VariantWriteMapping } from "./writer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExistingVariantMapping = {
  sourceVariantFingerprint: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  sourceSku: string | null;
  shopifySku: string | null;
  skuSource: string;
};

// ---------------------------------------------------------------------------
// Persist mappings after a successful write
// ---------------------------------------------------------------------------

/**
 * Persist variant mappings for a single product after its Shopify write succeeds.
 *
 * Write semantics per spec:
 *   Shopify response → persist product/variant IDs → persist source identity → persist SKU + provenance
 *
 * Do not call this before the Shopify mutation succeeds.
 * Retries are idempotent — existing mappings are updated, not duplicated.
 */
export async function persistVariantMappings(
  shopId: string,
  product: CatalogProduct,
  writeResult: WriteResult,
): Promise<void> {
  if (!writeResult.success || !writeResult.shopifyProductId || !writeResult.variantMappings) {
    return; // Only persist on success
  }

  const prisma = getPrisma();
  const logger = getLogger();
  const variantMappings = writeResult.variantMappings;

  for (let i = 0; i < product.variants.length; i++) {
    const variant = product.variants[i];
    const mapping: VariantWriteMapping | undefined = variantMappings[i];

    if (!mapping) {
      // Shopify returned fewer variants than we sent — shouldn't happen, but be safe
      logger.warn("No Shopify variant mapping for source variant", {
        productSourceKey: product.sourceKey,
        variantIndex: i,
        totalShopifyVariants: variantMappings.length,
      });
      continue;
    }

    const fingerprint = computeVariantFingerprint(product.sourceKey, variant, i);

    // Determine SKU provenance
    const sourceSku = variant.sku?.trim() || null;
    const shopifySku = mapping.shopifySku;
    const skuSource = resolveSkuSource(variant);

    try {
      await prisma.catalogVariantMapping.upsert({
        where: {
          shopId_sourceVariantFingerprint: {
            shopId,
            sourceVariantFingerprint: fingerprint,
          },
        },
        create: {
          shopId,
          sourceProductKey: product.sourceKey,
          sourceVariantKey: variant.sourceKey,
          sourceVariantFingerprint: fingerprint,
          shopifyProductId: writeResult.shopifyProductId,
          shopifyVariantId: mapping.shopifyVariantId,
          sourceSku,
          shopifySku,
          skuSource,
        },
        update: {
          // On retry/re-import, update the Shopify IDs and SKU state
          shopifyProductId: writeResult.shopifyProductId,
          shopifyVariantId: mapping.shopifyVariantId,
          sourceVariantKey: variant.sourceKey,
          sourceSku,
          shopifySku,
          skuSource,
        },
      });
    } catch (err) {
      // Log but don't fail the import over a mapping persistence error
      logger.error("Failed to persist variant mapping", {
        shopId,
        productSourceKey: product.sourceKey,
        variantIndex: i,
        fingerprint,
        error: (err as Error).message,
      });
    }
  }

  logger.debug("Variant mappings persisted", {
    productSourceKey: product.sourceKey,
    shopifyProductId: writeResult.shopifyProductId,
    variantCount: product.variants.length,
  });
}

// ---------------------------------------------------------------------------
// Lookup existing mappings for a shop
// ---------------------------------------------------------------------------

/**
 * Lookup existing variant mappings for the given source variant fingerprints.
 * Used during import to detect previously-imported variants and preserve
 * their generated/merchant SKUs.
 */
export async function lookupExistingMappings(
  shopId: string,
  fingerprints: string[],
): Promise<Map<string, ExistingVariantMapping>> {
  if (fingerprints.length === 0) return new Map();

  const prisma = getPrisma();

  const mappings = await prisma.catalogVariantMapping.findMany({
    where: {
      shopId,
      sourceVariantFingerprint: { in: fingerprints },
    },
    select: {
      sourceVariantFingerprint: true,
      shopifyProductId: true,
      shopifyVariantId: true,
      sourceSku: true,
      shopifySku: true,
      skuSource: true,
    },
  });

  const result = new Map<string, ExistingVariantMapping>();
  for (const m of mappings) {
    result.set(m.sourceVariantFingerprint, m);
  }

  return result;
}

/**
 * Lookup all variant mappings for a product by its source product key.
 */
export async function lookupProductMappings(
  shopId: string,
  sourceProductKey: string,
): Promise<ExistingVariantMapping[]> {
  const prisma = getPrisma();

  return prisma.catalogVariantMapping.findMany({
    where: { shopId, sourceProductKey },
    select: {
      sourceVariantFingerprint: true,
      shopifyProductId: true,
      shopifyVariantId: true,
      sourceSku: true,
      shopifySku: true,
      skuSource: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the SkuSource enum value for a variant.
 * Uses the variant's skuSource field if set, otherwise infers from SKU presence.
 */
function resolveSkuSource(variant: CatalogProduct["variants"][0]): "SUPPLIER" | "MERCHANT" | "STOREDELIVERY_GENERATED" | "NONE" {
  if (variant.skuSource) {
    return variant.skuSource;
  }
  // Infer from SKU presence
  if (variant.sku && variant.sku.trim() !== "") {
    return "SUPPLIER";
  }
  return "NONE";
}
