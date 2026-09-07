/**
 * Override Merger — applies draft overrides onto immutable source products.
 *
 * Never mutates the original. Returns a new object with edits applied.
 * Supports dot-path fields (e.g. "title", "vendor", "variants[0].price").
 */

import type { CatalogProduct } from "@shared/types/catalog.js";

export type Override = {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  source: "user" | "bulk_rule" | "auto_fix";
};

/**
 * Apply a list of overrides to a product, returning a new resolved product.
 * The original product is never mutated.
 */
export function applyOverrides(
  product: CatalogProduct,
  overrides: Override[],
): CatalogProduct {
  if (overrides.length === 0) return product;

  // Deep clone to avoid mutating the original
  const resolved = JSON.parse(JSON.stringify(product)) as CatalogProduct;

  for (const override of overrides) {
    setNestedValue(resolved, override.field, override.newValue);
  }

  return resolved;
}

/**
 * Compute a diff between original and resolved product.
 * Returns the overrides that were actually applied (value changed).
 */
export function computeDiff(
  original: CatalogProduct,
  resolved: CatalogProduct,
): Array<{ field: string; oldValue: unknown; newValue: unknown }> {
  const diff: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

  // Top-level scalar fields
  const scalarFields = [
    "title",
    "description",
    "vendor",
    "productType",
  ] as const;

  for (const field of scalarFields) {
    if (original[field] !== resolved[field]) {
      diff.push({
        field,
        oldValue: original[field] ?? null,
        newValue: resolved[field] ?? null,
      });
    }
  }

  // Tags
  const origTags = (original.tags ?? []).join(",");
  const resTags = (resolved.tags ?? []).join(",");
  if (origTags !== resTags) {
    diff.push({
      field: "tags",
      oldValue: original.tags,
      newValue: resolved.tags,
    });
  }

  // Variants
  const maxVariants = Math.max(
    original.variants?.length ?? 0,
    resolved.variants?.length ?? 0,
  );
  for (let i = 0; i < maxVariants; i++) {
    const origV = original.variants?.[i];
    const resV = resolved.variants?.[i];

    const variantFields = [
      "sku",
      "barcode",
      "price",
      "compareAtPrice",
      "cost",
      "inventoryQuantity",
      "weight",
      "weightUnit",
    ] as const;

    for (const vf of variantFields) {
      const origVal = origV?.[vf] ?? null;
      const resVal = resV?.[vf] ?? null;
      if (String(origVal) !== String(resVal)) {
        diff.push({
          field: `variants[${i}].${vf}`,
          oldValue: origVal,
          newValue: resVal,
        });
      }
    }
  }

  return diff;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set a value at a dot-path on an object. Supports array indexing.
 *
 * Examples:
 *   "title" → obj.title = value
 *   "variants[0].price" → obj.variants[0].price = value
 *   "tags" → obj.tags = value
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = parsePath(path);
  let current: unknown = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (typeof seg === "number") {
      current = (current as unknown[])[seg];
    } else {
      current = (current as Record<string, unknown>)[seg];
    }
    if (current === undefined || current === null) return;
  }

  const lastSeg = segments[segments.length - 1];
  if (typeof lastSeg === "number") {
    (current as unknown[])[lastSeg] = value;
  } else {
    (current as Record<string, unknown>)[lastSeg] = value;
  }
}

/**
 * Parse a dot-path like "variants[0].price" into segments: ["variants", 0, "price"]
 */
function parsePath(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const parts = path.split(".");

  for (const part of parts) {
    const bracketMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (bracketMatch) {
      segments.push(bracketMatch[1]);
      segments.push(parseInt(bracketMatch[2], 10));
    } else {
      segments.push(part);
    }
  }

  return segments;
}

export { setNestedValue as _setNestedValue, parsePath as _parsePath };
