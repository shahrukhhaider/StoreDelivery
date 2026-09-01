/**
 * Product / Variant Grouping — Section 9
 *
 * Determines how flat spreadsheet rows get grouped into
 * products and their variants.
 */

import type { FieldMapping } from "@shared/types/mapping.js";
import type { ParsedSheet } from "../parser/index.js";
import type {
  CatalogProduct,
  CatalogVariant,
  CatalogImage,
} from "@shared/types/catalog.js";
import {
  normalizePrice,
  normalizeInteger,
  normalizeWeight,
  normalizeTags,
  normalizeText,
} from "../normalizer/normalizer.js";

export type GroupingResult = {
  products: CatalogProduct[];
  /** Groups that were ambiguous and need preview/confirmation */
  ambiguousGroups: AmbiguousGroup[];
};

export type AmbiguousGroup = {
  proposedTitle: string;
  rowIndices: number[];
  reason: string;
};

/**
 * Group parsed rows into products with variants.
 */
export function groupRows(
  sheet: ParsedSheet,
  mappings: FieldMapping[],
): GroupingResult {
  // Build lookup: targetField → sourceColumn
  const fieldToColumn = new Map<string, string>();
  const imageColumns: string[] = [];

  for (const m of mappings) {
    if (m.targetField && !m.ignored) {
      if (m.targetField === "image.url") {
        imageColumns.push(m.sourceColumn);
      } else {
        fieldToColumn.set(m.targetField, m.sourceColumn);
      }
    }
  }

  const parentKeyCol = fieldToColumn.get("grouping.parentKey");
  const titleCol = fieldToColumn.get("product.title");
  const option1Col = fieldToColumn.get("variant.option1");
  const skuCol = fieldToColumn.get("variant.sku");

  // Determine grouping strategy
  if (parentKeyCol) {
    return groupByParentKey(sheet, mappings, fieldToColumn, imageColumns, parentKeyCol);
  }

  if (titleCol && option1Col) {
    return groupByTitleAndOptions(sheet, mappings, fieldToColumn, imageColumns, titleCol);
  }

  if (skuCol) {
    return groupBySkuPrefix(sheet, mappings, fieldToColumn, imageColumns, skuCol, titleCol);
  }

  if (titleCol) {
    return groupByTitleAndOptions(sheet, mappings, fieldToColumn, imageColumns, titleCol);
  }

  // Fallback: each row is a standalone product
  return groupStandalone(sheet, mappings, fieldToColumn, imageColumns);
}

// ---------------------------------------------------------------------------
// Strategy 1: Group by explicit parent key
// ---------------------------------------------------------------------------

function groupByParentKey(
  sheet: ParsedSheet,
  _mappings: FieldMapping[],
  fieldToColumn: Map<string, string>,
  imageColumns: string[],
  parentKeyCol: string,
): GroupingResult {
  const groups = new Map<string, number[]>();

  for (let i = 0; i < sheet.rows.length; i++) {
    const key = sheet.rows[i][parentKeyCol]?.trim() || `_standalone_${i}`;
    const existing = groups.get(key) ?? [];
    existing.push(i);
    groups.set(key, existing);
  }

  const products: CatalogProduct[] = [];
  for (const [groupKey, indices] of groups) {
    products.push(
      buildProduct(sheet, fieldToColumn, imageColumns, indices, groupKey),
    );
  }

  return { products, ambiguousGroups: [] };
}

// ---------------------------------------------------------------------------
// Strategy 2: Group by shared title + options
// ---------------------------------------------------------------------------

function groupByTitleAndOptions(
  sheet: ParsedSheet,
  _mappings: FieldMapping[],
  fieldToColumn: Map<string, string>,
  imageColumns: string[],
  titleCol: string,
): GroupingResult {
  const groups = new Map<string, number[]>();

  for (let i = 0; i < sheet.rows.length; i++) {
    const title = normalizeText(sheet.rows[i][titleCol] ?? "").toLowerCase();
    const key = title || `_untitled_${i}`;
    const existing = groups.get(key) ?? [];
    existing.push(i);
    groups.set(key, existing);
  }

  const products: CatalogProduct[] = [];
  const ambiguousGroups: AmbiguousGroup[] = [];

  for (const [, indices] of groups) {
    const firstRow = sheet.rows[indices[0]];
    const title = normalizeText(firstRow[titleCol] ?? "");

    // If multiple rows share a title but have no option differentiation, flag as ambiguous
    const option1Col = fieldToColumn.get("variant.option1");
    if (indices.length > 1 && !option1Col) {
      ambiguousGroups.push({
        proposedTitle: title,
        rowIndices: indices,
        reason:
          "Multiple rows share the same title but no option column is mapped to differentiate variants",
      });
    }

    const sourceKey = firstRow[fieldToColumn.get("variant.sku") ?? ""]?.trim() ||
      firstRow[fieldToColumn.get("grouping.parentKey") ?? ""]?.trim() ||
      `row_${indices[0]}`;

    products.push(
      buildProduct(sheet, fieldToColumn, imageColumns, indices, sourceKey),
    );
  }

  return { products, ambiguousGroups };
}

// ---------------------------------------------------------------------------
// Strategy 3: Group by SKU prefix
// ---------------------------------------------------------------------------

function groupBySkuPrefix(
  sheet: ParsedSheet,
  _mappings: FieldMapping[],
  fieldToColumn: Map<string, string>,
  imageColumns: string[],
  skuCol: string,
  titleCol: string | undefined,
): GroupingResult {
  // Extract all SKUs
  const skus = sheet.rows.map((row) => row[skuCol]?.trim() ?? "");

  // Try to find a common prefix pattern: split by last delimiter (-, _, .)
  const prefixGroups = new Map<string, number[]>();

  for (let i = 0; i < skus.length; i++) {
    const sku = skus[i];
    const prefix = extractSkuPrefix(sku);
    if (prefix && prefix !== sku) {
      const existing = prefixGroups.get(prefix) ?? [];
      existing.push(i);
      prefixGroups.set(prefix, existing);
    }
  }

  // Only use prefix grouping if we actually found groups (more than 1 member)
  // AND rows in the group share the same title (if a title column exists)
  const validGroups = new Map<string, number[]>();

  for (const [prefix, indices] of prefixGroups) {
    if (indices.length <= 1) continue;

    if (titleCol) {
      // Only group by prefix when titles also match
      const titleSubgroups = new Map<string, number[]>();
      for (const idx of indices) {
        const title = normalizeText(sheet.rows[idx][titleCol] ?? "").toLowerCase();
        const existing = titleSubgroups.get(title) ?? [];
        existing.push(idx);
        titleSubgroups.set(title, existing);
      }

      for (const [, subIndices] of titleSubgroups) {
        if (subIndices.length > 1) {
          validGroups.set(`${prefix}_${subIndices[0]}`, subIndices);
        }
      }
    } else {
      validGroups.set(prefix, indices);
    }
  }

  const hasGroups = validGroups.size > 0;

  if (!hasGroups) {
    // Fall back to standalone
    return groupStandalone(sheet, _mappings, fieldToColumn, imageColumns);
  }

  // Build products from prefix groups
  const products: CatalogProduct[] = [];
  const assigned = new Set<number>();

  for (const [prefix, indices] of validGroups) {
    products.push(
      buildProduct(sheet, fieldToColumn, imageColumns, indices, prefix),
    );
    for (const idx of indices) assigned.add(idx);
  }

  // Remaining rows are standalone
  for (let i = 0; i < sheet.rows.length; i++) {
    if (!assigned.has(i)) {
      products.push(
        buildProduct(sheet, fieldToColumn, imageColumns, [i], skus[i] || `row_${i}`),
      );
    }
  }

  return { products, ambiguousGroups: [] };
}

/**
 * Extract a prefix from a SKU by removing the last segment after a delimiter.
 * e.g. "SHOE-001-RED" → "SHOE-001", "ABC_123_M" → "ABC_123"
 */
function extractSkuPrefix(sku: string): string | null {
  if (!sku) return null;
  const match = sku.match(/^(.+)[_\-.]([^_\-.]+)$/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Fallback: each row is a standalone product
// ---------------------------------------------------------------------------

function groupStandalone(
  sheet: ParsedSheet,
  _mappings: FieldMapping[],
  fieldToColumn: Map<string, string>,
  imageColumns: string[],
): GroupingResult {
  const products: CatalogProduct[] = [];

  for (let i = 0; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const sourceKey =
      row[fieldToColumn.get("variant.sku") ?? ""]?.trim() || `row_${i}`;
    products.push(
      buildProduct(sheet, fieldToColumn, imageColumns, [i], sourceKey),
    );
  }

  return { products, ambiguousGroups: [] };
}

// ---------------------------------------------------------------------------
// Build a CatalogProduct from a set of row indices
// ---------------------------------------------------------------------------

function buildProduct(
  sheet: ParsedSheet,
  fieldToColumn: Map<string, string>,
  imageColumns: string[],
  rowIndices: number[],
  sourceKey: string,
): CatalogProduct {
  const firstRow = sheet.rows[rowIndices[0]];

  const getField = (target: string): string =>
    firstRow[fieldToColumn.get(target) ?? ""]?.trim() ?? "";

  // Build variants from all rows in the group
  const variants: CatalogVariant[] = rowIndices.map((idx) => {
    const row = sheet.rows[idx];
    const getRowField = (target: string): string =>
      row[fieldToColumn.get(target) ?? ""]?.trim() ?? "";

    const options: Record<string, string> = {};
    const opt1 = getRowField("variant.option1");
    const opt2 = getRowField("variant.option2");
    const opt3 = getRowField("variant.option3");
    if (opt1) options["Option 1"] = normalizeText(opt1);
    if (opt2) options["Option 2"] = normalizeText(opt2);
    if (opt3) options["Option 3"] = normalizeText(opt3);

    const weightResult = normalizeWeight(getRowField("variant.weight"));

    return {
      sourceKey:
        getRowField("variant.sku") || `${sourceKey}_v${idx}`,
      sku: getRowField("variant.sku") || undefined,
      barcode: getRowField("variant.barcode") || undefined,
      options,
      price: normalizePrice(getRowField("variant.price")) ?? undefined,
      compareAtPrice:
        normalizePrice(getRowField("variant.compareAtPrice")) ?? undefined,
      cost: normalizePrice(getRowField("variant.cost")) ?? undefined,
      inventoryQuantity:
        normalizeInteger(getRowField("variant.inventoryQuantity")) ?? undefined,
      weight: weightResult?.value,
      weightUnit: weightResult?.unit,
      sourceData: { ...row },
    };
  });

  // Collect images from all image columns across all rows
  const images: CatalogImage[] = [];
  const seenUrls = new Set<string>();
  let position = 1;

  for (const idx of rowIndices) {
    const row = sheet.rows[idx];
    for (const col of imageColumns) {
      const url = row[col]?.trim();
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        images.push({
          sourceUrl: url,
          position: position++,
          variantSourceKey:
            rowIndices.length > 1
              ? (row[fieldToColumn.get("variant.sku") ?? ""]?.trim() || undefined)
              : undefined,
        });
      }
    }
  }

  const rawTags = getField("product.tags");

  return {
    sourceKey,
    title: normalizeText(getField("product.title")),
    description: normalizeText(getField("product.description")) || undefined,
    vendor: normalizeText(getField("product.vendor")) || undefined,
    productType: normalizeText(getField("product.productType")) || undefined,
    tags: normalizeTags(rawTags),
    variants,
    images,
    sourceData: { ...firstRow },
  };
}
