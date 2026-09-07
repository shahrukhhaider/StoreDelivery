/**
 * Product Fingerprint — deterministic source identity for product mapping.
 *
 * Used for stable dedup within a supplier profile, not for fuzzy matching.
 * The fingerprint is the unique key for ProductMapping within a profile.
 */

import type { CatalogProduct } from "@shared/types/catalog.js";

/**
 * Compute a deterministic fingerprint for a source product.
 *
 * Uses the strongest stable product-level identifier:
 *   1. sourceKey (supplier product ID / handle) — always available, primary identity
 *
 * The fingerprint is normalized to lowercase.
 * This is NOT used for fuzzy matching — that's evidence-based in the engine.
 */
export function computeProductFingerprint(product: CatalogProduct): string {
  // sourceKey is the primary stable product identity
  // It comes from the grouping engine (parent key, title, SKU prefix)
  return normalize(product.sourceKey);
}

/**
 * Compute fingerprints for a batch of products.
 */
export function computeProductFingerprints(
  products: CatalogProduct[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const p of products) {
    result.set(p.sourceKey, computeProductFingerprint(p));
  }
  return result;
}

function normalize(raw: string): string {
  return raw.toLowerCase().trim();
}
