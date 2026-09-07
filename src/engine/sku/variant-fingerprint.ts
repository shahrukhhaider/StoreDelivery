/**
 * Variant Fingerprint — deterministic source identity for variant mapping.
 *
 * Picks the strongest stable identifier available, in order:
 *   1. Supplier variant ID (sourceKey if it looks like an explicit ID)
 *   2. Supplier SKU
 *   3. Barcode / MPN
 *   4. Derived fingerprint from sourceProductKey + normalized options
 *
 * The fingerprint is used as the unique key for CatalogVariantMapping.
 * Generated Shopify SKUs are never used as source identity.
 */

import type { CatalogVariant } from "@shared/types/catalog.js";

/**
 * Compute a deterministic fingerprint for a variant within its product.
 *
 * @param productSourceKey - The parent product's sourceKey
 * @param variant - The variant to fingerprint
 * @param variantIndex - Positional index (0-based) as a last-resort disambiguator
 * @returns A stable string that uniquely identifies this source variant
 */
export function computeVariantFingerprint(
  productSourceKey: string,
  variant: CatalogVariant,
  variantIndex: number,
): string {
  // 1. If the variant has an explicit source key that differs from the product key,
  //    treat it as a supplier variant ID — the strongest identity.
  if (
    variant.sourceKey &&
    variant.sourceKey.trim() !== "" &&
    variant.sourceKey !== productSourceKey
  ) {
    return normalize(variant.sourceKey);
  }

  // 2. Supplier SKU (only use non-generated SKUs as identity)
  if (
    variant.sku &&
    variant.sku.trim() !== "" &&
    variant.skuSource !== "STOREDELIVERY_GENERATED"
  ) {
    return normalize(`sku:${variant.sku}`);
  }

  // 3. Barcode / MPN
  if (variant.barcode && variant.barcode.trim() !== "") {
    return normalize(`barcode:${variant.barcode}`);
  }

  // 4. Derived fingerprint: productSourceKey + sorted normalized options
  //    Example: "AC123|color=red|size=medium"
  const optionParts = Object.entries(variant.options)
    .filter(([, v]) => v && v.trim() !== "")
    .map(([k, v]) => `${normalizeKey(k)}=${normalizeValue(v)}`)
    .sort();

  if (optionParts.length > 0) {
    return normalize(`${productSourceKey}|${optionParts.join("|")}`);
  }

  // 5. Absolute fallback: product key + positional index
  //    This is the weakest identity — if the source file reorders rows,
  //    the mapping will break. But it's better than nothing.
  return normalize(`${productSourceKey}|#${variantIndex}`);
}

/**
 * Compute fingerprints for all variants in a product.
 */
export function computeProductFingerprints(
  productSourceKey: string,
  variants: CatalogVariant[],
): string[] {
  return variants.map((v, i) => computeVariantFingerprint(productSourceKey, v, i));
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalize(raw: string): string {
  return raw.toLowerCase().trim();
}

function normalizeKey(key: string): string {
  return key.toLowerCase().trim().replace(/\s+/g, "_");
}

function normalizeValue(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}
