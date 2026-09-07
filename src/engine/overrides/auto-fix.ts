/**
 * Auto-Fix Detector — identifies and generates safe deterministic fixes.
 *
 * These fixes are applied as overrides with source "auto_fix".
 * They never touch ambiguous identity, destructive changes, or business decisions.
 */

import type { CatalogProduct } from "@shared/types/catalog.js";
import type { Override } from "./merge.js";

export type AutoFixSummary = {
  overrides: Override[];
  /** Count by fix type for reporting */
  breakdown: Record<string, number>;
  totalFixed: number;
  totalSkipped: number;
};

/**
 * Scan a product for safe deterministic fixes.
 * Returns overrides that can be applied without merchant input.
 */
export function detectAutoFixes(product: CatalogProduct): Override[] {
  const fixes: Override[] = [];

  // Title: whitespace normalization
  if (product.title && product.title !== product.title.trim().replace(/\s+/g, " ")) {
    fixes.push({
      field: "title",
      oldValue: product.title,
      newValue: product.title.trim().replace(/\s+/g, " "),
      source: "auto_fix",
    });
  }

  // Description: whitespace normalization
  if (
    product.description &&
    product.description !== product.description.trim()
  ) {
    fixes.push({
      field: "description",
      oldValue: product.description,
      newValue: product.description.trim(),
      source: "auto_fix",
    });
  }

  // Vendor: whitespace
  if (product.vendor && product.vendor !== product.vendor.trim()) {
    fixes.push({
      field: "vendor",
      oldValue: product.vendor,
      newValue: product.vendor.trim(),
      source: "auto_fix",
    });
  }

  // Variants
  for (let i = 0; i < product.variants.length; i++) {
    const v = product.variants[i];

    // Price: strip currency symbols, normalize format
    if (v.price) {
      const cleaned = cleanPrice(v.price);
      if (cleaned && cleaned !== v.price) {
        fixes.push({
          field: `variants[${i}].price`,
          oldValue: v.price,
          newValue: cleaned,
          source: "auto_fix",
        });
      }
    }

    // Compare at price
    if (v.compareAtPrice) {
      const cleaned = cleanPrice(v.compareAtPrice);
      if (cleaned && cleaned !== v.compareAtPrice) {
        fixes.push({
          field: `variants[${i}].compareAtPrice`,
          oldValue: v.compareAtPrice,
          newValue: cleaned,
          source: "auto_fix",
        });
      }
    }

    // Cost
    if (v.cost) {
      const cleaned = cleanPrice(v.cost);
      if (cleaned && cleaned !== v.cost) {
        fixes.push({
          field: `variants[${i}].cost`,
          oldValue: v.cost,
          newValue: cleaned,
          source: "auto_fix",
        });
      }
    }

    // SKU: trim whitespace
    if (v.sku && v.sku !== v.sku.trim()) {
      fixes.push({
        field: `variants[${i}].sku`,
        oldValue: v.sku,
        newValue: v.sku.trim(),
        source: "auto_fix",
      });
    }

    // Barcode: trim whitespace
    if (v.barcode && v.barcode !== v.barcode.trim()) {
      fixes.push({
        field: `variants[${i}].barcode`,
        oldValue: v.barcode,
        newValue: v.barcode.trim(),
        source: "auto_fix",
      });
    }

    // Weight unit normalization
    if (v.weightUnit) {
      const normalized = normalizeWeightUnit(v.weightUnit);
      if (normalized !== v.weightUnit) {
        fixes.push({
          field: `variants[${i}].weightUnit`,
          oldValue: v.weightUnit,
          newValue: normalized,
          source: "auto_fix",
        });
      }
    }
  }

  return fixes;
}

/**
 * Run auto-fix detection on a batch of products.
 */
export function detectAllAutoFixes(
  products: CatalogProduct[],
): AutoFixSummary {
  const allOverrides: Override[] = [];
  const breakdown: Record<string, number> = {};
  let totalSkipped = 0;

  for (const product of products) {
    const fixes = detectAutoFixes(product);
    for (const fix of fixes) {
      allOverrides.push(fix);
      const type = classifyFix(fix.field);
      breakdown[type] = (breakdown[type] ?? 0) + 1;
    }
    if (fixes.length === 0) totalSkipped++;
  }

  return {
    overrides: allOverrides,
    breakdown,
    totalFixed: allOverrides.length,
    totalSkipped,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clean a price string: strip currency symbols, normalize whitespace.
 * Returns null if the result is the same as input.
 */
function cleanPrice(raw: string): string | null {
  let cleaned = raw.trim();

  // Strip common currency symbols
  cleaned = cleaned.replace(/^[\s$€£¥₹]+|[\s$€£¥₹]+$/g, "").trim();

  // Remove spaces around the number
  cleaned = cleaned.replace(/\s/g, "");

  return cleaned === raw ? null : cleaned;
}

function normalizeWeightUnit(unit: string): string {
  const lower = unit.toLowerCase().trim();
  const map: Record<string, string> = {
    lb: "lb",
    lbs: "lb",
    pound: "lb",
    pounds: "lb",
    kg: "kg",
    kgs: "kg",
    kilogram: "kg",
    kilograms: "kg",
    g: "g",
    gram: "g",
    grams: "g",
    oz: "oz",
    ounce: "oz",
    ounces: "oz",
  };
  return map[lower] ?? unit;
}

function classifyFix(field: string): string {
  if (field.includes("price") || field.includes("cost") || field.includes("compareAtPrice")) {
    return "currency_cleanup";
  }
  if (field.includes("weightUnit")) return "weight_unit_normalization";
  if (field === "title" || field === "description" || field === "vendor") {
    return "whitespace_normalization";
  }
  if (field.includes("sku") || field.includes("barcode")) {
    return "whitespace_normalization";
  }
  return "other";
}
