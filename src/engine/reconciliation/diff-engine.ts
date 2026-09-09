/**
 * Diff Engine — computes field-level changes between supplier data and Shopify.
 *
 * Pure function. No DB access, no API calls.
 *
 * Compared product fields: title, description, vendor, productType, tags, images
 * Compared variant fields: price, compareAtPrice, barcode, inventoryQuantity, weight
 *
 * Excluded from diff:
 *   - SKU (governed by provenance spec)
 *   - options (variant identity, not data)
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
  compareField(changes, "description", shopify.description ?? null, supplier.description ?? null);
  compareField(changes, "vendor", shopify.vendor ?? null, supplier.vendor ?? null);
  compareField(changes, "productType", shopify.productType ?? null, supplier.productType ?? null);

  // Tags: compare as sorted strings
  const shopifyTags = (shopify.tags ?? []).slice().sort().join(", ");
  const supplierTags = (supplier.tags ?? []).slice().sort().join(", ");
  compareField(changes, "tags", shopifyTags || null, supplierTags || null);

  // Images: compare by URL set (order-independent)
  const shopifyImageUrls = (shopify.images ?? []).map((i) => i.url).sort().join("|");
  const supplierImageUrls = (supplier.images ?? []).map((i) => i.sourceUrl).sort().join("|");
  if (shopifyImageUrls !== supplierImageUrls && (shopifyImageUrls || supplierImageUrls)) {
    const shopifyCount = (shopify.images ?? []).length;
    const supplierCount = (supplier.images ?? []).length;
    changes.push({
      field: "images",
      shopifyValue: shopifyCount > 0 ? `${shopifyCount} image${shopifyCount !== 1 ? "s" : ""}` : null,
      supplierValue: supplierCount > 0 ? `${supplierCount} image${supplierCount !== 1 ? "s" : ""}` : null,
      selected: true,
    });
  }

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

  compareField(changes, "price", shopify.price, supplier.price ?? null);
  compareField(changes, "compareAtPrice", shopify.compareAtPrice, supplier.compareAtPrice ?? null);
  compareField(changes, "barcode", shopify.barcode, supplier.barcode ?? null);

  // Cost — only diff if supplier explicitly provides a value (avoid clearing merchant-set costs)
  if (supplier.cost != null) {
    compareField(changes, "cost", shopify.cost, supplier.cost);
  }

  // Inventory quantity
  const shopifyQty = shopify.inventoryQuantity != null ? String(shopify.inventoryQuantity) : null;
  const supplierQty = supplier.inventoryQuantity != null ? String(supplier.inventoryQuantity) : null;
  compareField(changes, "inventoryQuantity", shopifyQty, supplierQty);

  // Weight — normalise units to Shopify canonical form before comparing so that
  // "1.5 kg" and "1.5 KILOGRAMS" are not reported as a change.
  const shopifyWeight =
    shopify.weight != null
      ? `${shopify.weight} ${normalizeWeightUnit(shopify.weightUnit ?? "")}`
      : null;
  const supplierWeight =
    supplier.weight != null
      ? `${supplier.weight} ${normalizeWeightUnit(supplier.weightUnit ?? "")}`
      : null;
  compareField(changes, "weight", shopifyWeight, supplierWeight);

  // Taxable flag — only diff if supplier explicitly provides a value
  if (supplier.taxable != null) {
    const shopifyTaxable = shopify.taxable != null ? String(shopify.taxable) : null;
    const supplierTaxable = String(supplier.taxable);
    compareField(changes, "taxable", shopifyTaxable, supplierTaxable);
  }

  // Inventory policy (DENY | CONTINUE) — only diff if supplier explicitly provides a value
  if (supplier.inventoryPolicy != null) {
    compareField(changes, "inventoryPolicy", shopify.inventoryPolicy, supplier.inventoryPolicy);
  }

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

/**
 * Normalise a weight unit string to the Shopify WeightUnit enum form.
 * Shopify accepts: KILOGRAMS, GRAMS, POUNDS, OUNCES.
 * Supplier files often use: kg, g, lb, oz, lbs, kilogram, gram, pound, ounce.
 */
function normalizeWeightUnit(unit: string): string {
  switch (unit.toLowerCase().trim()) {
    case "kg":
    case "kilogram":
    case "kilograms":
      return "KILOGRAMS";
    case "g":
    case "gram":
    case "grams":
      return "GRAMS";
    case "lb":
    case "lbs":
    case "pound":
    case "pounds":
      return "POUNDS";
    case "oz":
    case "ounce":
    case "ounces":
      return "OUNCES";
    default:
      // Return uppercase as-is — if Shopify already sent it, it's already canonical
      return unit.toUpperCase();
  }
}
