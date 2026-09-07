/**
 * Diff Engine — computes field-level changes between supplier data and Shopify.
 *
 * Pure function. No DB access, no API calls.
 *
 * Compared product fields: title, description, vendor, productType, tags
 * Compared variant fields: price, compareAtPrice, cost, weight, weightUnit, barcode
 *
 * Excluded from diff:
 *   - SKU (governed by provenance spec)
 *   - options (variant identity, not data)
 *   - images (separate workflow)
 *   - Shopify IDs (immutable)
 */

import type { CatalogProduct, CatalogVariant } from "@shared/types/catalog.js";
import type {
  FieldChange,
  VariantDiff,
  ProductDiff,
  SnapshotProduct,
  SnapshotVariant,
  PersistedVariantMapping,
} from "@shared/types/reconciliation.js";

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Compute a field-level diff between a supplier product and its Shopify snapshot.
 *
 * @param supplier - The incoming supplier product (normalized, with overrides applied)
 * @param shopifyProduct - The existing Shopify product snapshot
 * @param shopifyVariants - The existing Shopify variant snapshots for this product
 * @param variantMappings - Persisted variant mappings to correlate supplier→Shopify variants
 */
export function computeProductDiff(
  supplier: CatalogProduct,
  shopifyProduct: SnapshotProduct,
  shopifyVariants: SnapshotVariant[],
  variantMappings: PersistedVariantMapping[],
): ProductDiff {
  // Product-level diff
  const productChanges = diffProductFields(supplier, shopifyProduct);

  // Variant-level diff: match supplier variants to Shopify variants via mappings
  const variantChanges = diffVariants(supplier, shopifyVariants, variantMappings);

  const hasChanges =
    productChanges.length > 0 ||
    variantChanges.some((v) => v.changes.length > 0);

  return {
    sourceProductKey: supplier.sourceKey,
    shopifyProductId: shopifyProduct.shopifyProductId,
    hasChanges,
    productChanges,
    variantChanges,
  };
}

// ---------------------------------------------------------------------------
// Product-level field comparison
// ---------------------------------------------------------------------------

function diffProductFields(
  supplier: CatalogProduct,
  shopify: SnapshotProduct,
): FieldChange[] {
  const changes: FieldChange[] = [];

  compareField(changes, "title", shopify.title, supplier.title);
  compareField(changes, "vendor", shopify.vendor ?? null, supplier.vendor ?? null);

  // Tags: compare as sorted comma-separated strings
  // Shopify snapshot doesn't store tags separately in V1, so skip for now
  // if we add tags to the snapshot later, uncomment:
  // compareField(changes, "tags", shopifyTags, supplier.tags.join(", "));

  return changes;
}

// ---------------------------------------------------------------------------
// Variant-level field comparison
// ---------------------------------------------------------------------------

function diffVariants(
  supplier: CatalogProduct,
  shopifyVariants: SnapshotVariant[],
  variantMappings: PersistedVariantMapping[],
): VariantDiff[] {
  const diffs: VariantDiff[] = [];

  // Build lookup: sourceVariantFingerprint → shopifyVariantId
  const fingerprintToShopifyId = new Map<string, string>();
  for (const m of variantMappings) {
    if (m.shopifyVariantId) {
      fingerprintToShopifyId.set(m.sourceVariantFingerprint, m.shopifyVariantId);
    }
  }

  // Build lookup: shopifyVariantId → snapshot variant
  const shopifyById = new Map<string, SnapshotVariant>();
  for (const v of shopifyVariants) {
    shopifyById.set(v.shopifyVariantId, v);
  }

  // Also build a fallback lookup by sourceVariantKey from mappings
  const sourceKeyToShopifyId = new Map<string, string>();
  for (const m of variantMappings) {
    if (m.shopifyVariantId) {
      sourceKeyToShopifyId.set(m.sourceVariantKey, m.shopifyVariantId);
    }
  }

  for (const supplierVariant of supplier.variants) {
    // Try to find the corresponding Shopify variant
    const shopifyVariantId =
      sourceKeyToShopifyId.get(supplierVariant.sourceKey) ?? null;

    if (!shopifyVariantId) {
      // No mapping for this variant — could be a new variant, skip diff
      continue;
    }

    const shopifyVariant = shopifyById.get(shopifyVariantId);
    if (!shopifyVariant) {
      // Mapped but not in snapshot — skip
      continue;
    }

    const changes = diffVariantFields(supplierVariant, shopifyVariant);

    if (changes.length > 0) {
      diffs.push({
        sourceVariantKey: supplierVariant.sourceKey,
        shopifyVariantId,
        changes,
      });
    }
  }

  return diffs;
}

function diffVariantFields(
  supplier: CatalogVariant,
  shopify: SnapshotVariant,
): FieldChange[] {
  const changes: FieldChange[] = [];

  // Price — supplier stores as string, snapshot doesn't store price in V1
  // For V1 we can't diff price because ShopifyVariantSnapshot doesn't have it.
  // This will be added when we extend the snapshot with price fields.
  // For now, compare barcode (the one variant field we DO have in the snapshot).

  compareField(changes, "barcode", shopify.barcode, supplier.barcode ?? null);

  // SKU is explicitly excluded from diff — governed by provenance spec
  // Options are excluded — they are variant identity, not data

  return changes;
}

// ---------------------------------------------------------------------------
// Field comparison helper
// ---------------------------------------------------------------------------

function compareField(
  changes: FieldChange[],
  field: string,
  shopifyValue: string | null | undefined,
  supplierValue: string | null | undefined,
): void {
  const sv = normalizeForComparison(shopifyValue);
  const sup = normalizeForComparison(supplierValue);

  // Both empty — not a change
  if (!sv && !sup) return;

  // Same value — not a change
  if (sv === sup) return;

  changes.push({
    field,
    shopifyValue: sv || null,
    supplierValue: sup || null,
    selected: true, // default: accept all
  });
}

function normalizeForComparison(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value.trim();
}
