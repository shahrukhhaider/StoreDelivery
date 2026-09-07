/**
 * Reconciliation Engine — pure classification logic.
 *
 * Classifies each source product against persisted mappings and Shopify
 * store identifiers. No DB access, no side effects.
 *
 * Classification priority:
 *   1. Persisted mapping exists → EXISTING_MAPPED
 *   2. Strong Shopify evidence (SKU/barcode) → LIKELY_EXISTING
 *   3. Ambiguous evidence → NEEDS_REVIEW
 *   4. No match → NEW_PRODUCT
 *
 * Title/handle alone never auto-establishes durable identity.
 */

import type { CatalogProduct } from "@shared/types/catalog.js";
import type {
  ProductClassification,
  ReconciliationSummary,
  PersistedProductMapping,
  ShopifyIdentityIndex,
  MatchEvidence,
  MatchConfidence,
  ReconciliationClassification,
  ProposedAction,
} from "@shared/types/reconciliation.js";

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export type ClassifyProductsInput = {
  products: CatalogProduct[];
  /** Persisted mappings keyed by sourceProductKey. */
  existingMappings: Map<string, PersistedProductMapping>;
  /** Shopify store identifiers for bootstrap matching. */
  shopifyIndex: ShopifyIdentityIndex;
};

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Classify a batch of source products.
 */
export function classifyProducts(
  input: ClassifyProductsInput,
): { classifications: ProductClassification[]; summary: ReconciliationSummary } {
  const classifications: ProductClassification[] = [];
  const summary: ReconciliationSummary = {
    totalProducts: input.products.length,
    existingMapped: 0,
    likelyExisting: 0,
    newProducts: 0,
    needsReview: 0,
    noChange: 0,
  };

  for (const product of input.products) {
    const result = classifyOne(product, input.existingMappings, input.shopifyIndex);
    classifications.push(result);

    switch (result.classification) {
      case "EXISTING_MAPPED": summary.existingMapped++; break;
      case "LIKELY_EXISTING": summary.likelyExisting++; break;
      case "NEW_PRODUCT": summary.newProducts++; break;
      case "NEEDS_REVIEW": summary.needsReview++; break;
      case "NO_CHANGE": summary.noChange++; break;
    }
  }

  return { classifications, summary };
}

// ---------------------------------------------------------------------------
// Single product classification
// ---------------------------------------------------------------------------

function classifyOne(
  product: CatalogProduct,
  existingMappings: Map<string, PersistedProductMapping>,
  shopifyIndex: ShopifyIdentityIndex,
): ProductClassification {
  // -----------------------------------------------------------------------
  // Step 1: Check persisted mapping (always preferred)
  // -----------------------------------------------------------------------
  const mapping = existingMappings.get(product.sourceKey);
  if (mapping && mapping.mappingStatus === "MAPPED" && mapping.shopifyProductId) {
    return {
      sourceProductKey: product.sourceKey,
      classification: "EXISTING_MAPPED",
      proposedAction: "NO_CHANGE",
      matchedShopifyProductId: mapping.shopifyProductId,
      productMappingId: mapping.id,
      confidence: "HIGH",
      matchEvidence: [{
        type: "persisted_mapping",
        sourceValue: product.sourceKey,
        shopifyProductId: mapping.shopifyProductId,
        confidence: "HIGH",
      }],
    };
  }

  // -----------------------------------------------------------------------
  // Step 2: Bootstrap against Shopify using variant identifiers
  // -----------------------------------------------------------------------
  const evidence = collectEvidence(product, shopifyIndex);

  if (evidence.length === 0) {
    // No match at all → new product
    return {
      sourceProductKey: product.sourceKey,
      classification: "NEW_PRODUCT",
      proposedAction: "CREATE_PRODUCT",
      matchedShopifyProductId: null,
      productMappingId: mapping?.id ?? null,
      confidence: null,
      matchEvidence: [],
    };
  }

  // Group evidence by Shopify product ID
  const byProductId = groupEvidenceByProduct(evidence);

  // If all evidence points to the same Shopify product
  if (byProductId.size === 1) {
    const [shopifyProductId, productEvidence] = [...byProductId.entries()][0];
    const confidence = computeConfidence(productEvidence, product);

    if (confidence === "HIGH") {
      return {
        sourceProductKey: product.sourceKey,
        classification: "LIKELY_EXISTING",
        proposedAction: "LINK_EXISTING_PRODUCT",
        matchedShopifyProductId: shopifyProductId,
        productMappingId: mapping?.id ?? null,
        confidence,
        matchEvidence: productEvidence,
      };
    }

    if (confidence === "MEDIUM") {
      return {
        sourceProductKey: product.sourceKey,
        classification: "NEEDS_REVIEW",
        proposedAction: "LINK_EXISTING_PRODUCT",
        matchedShopifyProductId: shopifyProductId,
        productMappingId: mapping?.id ?? null,
        confidence,
        matchEvidence: productEvidence,
      };
    }

    // LOW confidence → needs review
    return {
      sourceProductKey: product.sourceKey,
      classification: "NEEDS_REVIEW",
      proposedAction: "SKIP",
      matchedShopifyProductId: shopifyProductId,
      productMappingId: mapping?.id ?? null,
      confidence,
      matchEvidence: productEvidence,
    };
  }

  // Evidence points to multiple Shopify products → ambiguous
  return {
    sourceProductKey: product.sourceKey,
    classification: "NEEDS_REVIEW",
    proposedAction: "SKIP",
    matchedShopifyProductId: null,
    productMappingId: mapping?.id ?? null,
    confidence: "LOW",
    matchEvidence: evidence,
  };
}

// ---------------------------------------------------------------------------
// Evidence collection — variant-level identifier matching
// ---------------------------------------------------------------------------

function collectEvidence(
  product: CatalogProduct,
  index: ShopifyIdentityIndex,
): MatchEvidence[] {
  const evidence: MatchEvidence[] = [];

  for (const variant of product.variants) {
    // SKU match (strongest variant evidence)
    if (variant.sku && variant.sku.trim()) {
      const key = variant.sku.toLowerCase().trim();
      const match = index.skus.get(key);
      if (match) {
        evidence.push({
          type: "sku",
          sourceValue: variant.sku,
          shopifyProductId: match.productId,
          shopifyVariantId: match.variantId,
          confidence: "HIGH",
        });
      }
    }

    // Barcode match
    if (variant.barcode && variant.barcode.trim()) {
      const key = variant.barcode.toLowerCase().trim();
      const match = index.barcodes.get(key);
      if (match) {
        evidence.push({
          type: "barcode",
          sourceValue: variant.barcode,
          shopifyProductId: match.productId,
          shopifyVariantId: match.variantId,
          confidence: "HIGH",
        });
      }
    }
  }

  // NOTE: Title matching is deliberately excluded from evidence collection.
  // Per spec: "Title or handle alone should never auto-establish durable identity."

  return evidence;
}

// ---------------------------------------------------------------------------
// Evidence grouping and confidence scoring
// ---------------------------------------------------------------------------

function groupEvidenceByProduct(
  evidence: MatchEvidence[],
): Map<string, MatchEvidence[]> {
  const grouped = new Map<string, MatchEvidence[]>();
  for (const e of evidence) {
    if (!e.shopifyProductId) continue;
    const list = grouped.get(e.shopifyProductId) ?? [];
    list.push(e);
    grouped.set(e.shopifyProductId, list);
  }
  return grouped;
}

/**
 * Compute overall confidence from the evidence for a single Shopify product.
 *
 * HIGH: multiple variant identifiers match (e.g. 2+ SKUs, or SKU + barcode)
 * MEDIUM: single strong identifier match (1 SKU or 1 barcode)
 * LOW: weak evidence only
 */
function computeConfidence(
  evidence: MatchEvidence[],
  product: CatalogProduct,
): MatchConfidence {
  const skuMatches = evidence.filter((e) => e.type === "sku").length;
  const barcodeMatches = evidence.filter((e) => e.type === "barcode").length;
  const strongMatches = skuMatches + barcodeMatches;

  // Multiple strong matches → HIGH
  if (strongMatches >= 2) return "HIGH";

  // Single strong match with context
  if (strongMatches === 1) {
    // If the product only has 1 variant, a single SKU match is HIGH
    if (product.variants.length === 1) return "HIGH";
    // Otherwise, single match out of multiple variants → MEDIUM
    return "MEDIUM";
  }

  return "LOW";
}

// ---------------------------------------------------------------------------
// Reconciliation guard — pure function for snapshot enforcement
// ---------------------------------------------------------------------------

/**
 * Apply the reconciliation guard: downgrade NEW_PRODUCT to NEEDS_REVIEW
 * when no valid Shopify catalog snapshot exists.
 *
 * Hard invariant: an unmapped supplier product must not be classified as
 * NEW_PRODUCT unless StoreDelivery has a valid Shopify catalog snapshot.
 *
 * This is a pure function — no DB access. The caller determines whether
 * the snapshot is ready and passes that as a boolean.
 */
export function applySnapshotGuard(
  classifications: ProductClassification[],
  snapshotReady: boolean,
): { classifications: ProductClassification[]; summary: ReconciliationSummary; downgraded: number } {
  if (snapshotReady) {
    // No guard needed — return as-is with computed summary
    return {
      classifications,
      summary: computeSummary(classifications),
      downgraded: 0,
    };
  }

  let downgraded = 0;
  const guarded = classifications.map((c) => {
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

  return {
    classifications: guarded,
    summary: computeSummary(guarded),
    downgraded,
  };
}

function computeSummary(classifications: ProductClassification[]): ReconciliationSummary {
  return {
    totalProducts: classifications.length,
    existingMapped: classifications.filter((c) => c.classification === "EXISTING_MAPPED").length,
    likelyExisting: classifications.filter((c) => c.classification === "LIKELY_EXISTING").length,
    newProducts: classifications.filter((c) => c.classification === "NEW_PRODUCT").length,
    needsReview: classifications.filter((c) => c.classification === "NEEDS_REVIEW").length,
    noChange: classifications.filter((c) => c.classification === "NO_CHANGE").length,
  };
}
