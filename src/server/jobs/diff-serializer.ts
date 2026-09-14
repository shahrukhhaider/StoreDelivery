/**
 * Diff Serializer — converts a ProductDiff into the compact StoredDiff shape
 * that is persisted on ImportItem.appliedDiff.
 *
 * Pure function — no DB access, no side effects.
 * Exported so it can be unit-tested independently of the executor.
 */

import type { FieldChange, VariantDiff } from "@shared/types/reconciliation.js";

export type StoredFieldChange = {
  field: string;
  shopifyValue: string | null;
  supplierValue: string | null;
};

export type StoredVariantDiff = {
  sourceVariantKey: string;
  shopifyVariantId: string | null;
  status: "changed" | "added" | "discontinued";
  changes: StoredFieldChange[];
};

export type StoredDiff = {
  productChanges: StoredFieldChange[];
  variantChanges: StoredVariantDiff[];
};

/**
 * Build the StoredDiff from the selected productChanges and variantChanges
 * that were passed to applyProductUpdate.
 *
 * - Strips the `selected` boolean (always true at this point)
 * - Retains `shopifyValue` (pre-import value = rollback target)
 * - Retains `supplierValue` (value that was applied)
 * - Only includes variants that had selected field changes, or are added/discontinued
 */
export function buildStoredDiff(
  productChanges: FieldChange[],
  variantChanges: VariantDiff[],
): StoredDiff {
  return {
    productChanges: productChanges
      .filter((c) => c.selected)
      .map(({ field, shopifyValue, supplierValue }) => ({ field, shopifyValue, supplierValue })),
    variantChanges: variantChanges
      .filter(
        (v) =>
          v.changes.some((c) => c.selected) ||
          v.status === "added" ||
          v.status === "discontinued",
      )
      .map((v) => ({
        sourceVariantKey: v.sourceVariantKey,
        shopifyVariantId: v.shopifyVariantId ?? null,
        status: v.status ?? "changed",
        changes: v.changes
          .filter((c) => c.selected)
          .map(({ field, shopifyValue, supplierValue }) => ({ field, shopifyValue, supplierValue })),
      })),
  };
}
