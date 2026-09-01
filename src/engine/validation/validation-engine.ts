/**
 * Validation Engine — Section 10
 *
 * Validates a catalog after mapping and grouping, producing
 * blocking issues, warnings, and info-level messages.
 */

import type { CatalogProduct, CatalogIssue, IssueSeverity } from "@shared/types/catalog.js";

export type ValidationResult = {
  issues: CatalogIssue[];
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  autoFixedCount: number;
};

const MAX_REASONABLE_PRICE = 99999;
const MIN_REASONABLE_PRICE = 0.01;
const URL_SYNTAX_RE = /^https?:\/\/.+/i;

/**
 * Validate a list of catalog products and return all issues.
 */
export function validateCatalog(products: CatalogProduct[]): ValidationResult {
  const issues: CatalogIssue[] = [];
  let autoFixedCount = 0;

  // Catalog-level: no products at all
  if (products.length === 0) {
    issues.push(
      blocking("NO_PRODUCTS", "No products were extracted from the file"),
    );
    return summarize(issues, autoFixedCount);
  }

  // Track SKUs and barcodes for duplicate detection
  const seenSkus = new Map<string, string[]>(); // sku → sourceKeys
  const seenBarcodes = new Map<string, string[]>(); // barcode → sourceKeys

  for (const product of products) {
    // --- Blocking ---

    // Missing title
    if (!product.title || product.title.trim() === "") {
      issues.push(
        blocking(
          "MISSING_TITLE",
          "Product is missing a title",
          product.sourceKey,
          "title",
        ),
      );
    }

    // Invalid variant structure
    if (product.variants.length === 0) {
      issues.push(
        blocking(
          "NO_VARIANTS",
          "Product has no variants",
          product.sourceKey,
          "variants",
        ),
      );
    }

    for (const variant of product.variants) {
      // Malformed price
      if (variant.price !== undefined) {
        const price = parseFloat(variant.price);
        if (isNaN(price)) {
          issues.push(
            blocking(
              "MALFORMED_PRICE",
              `Price "${variant.price}" cannot be parsed as a number`,
              product.sourceKey,
              "price",
            ),
          );
        }
      }

      // --- Warnings ---

      // Missing SKU
      if (!variant.sku) {
        issues.push(
          warning(
            "MISSING_SKU",
            "Variant is missing a SKU",
            product.sourceKey,
            "sku",
          ),
        );
      }

      // Track SKU for duplicates
      if (variant.sku) {
        const key = variant.sku.toLowerCase();
        const existing = seenSkus.get(key) ?? [];
        existing.push(product.sourceKey);
        seenSkus.set(key, existing);
      }

      // Track barcode for duplicates
      if (variant.barcode) {
        const key = variant.barcode.toLowerCase();
        const existing = seenBarcodes.get(key) ?? [];
        existing.push(product.sourceKey);
        seenBarcodes.set(key, existing);
      }

      // Suspicious price
      if (variant.price !== undefined) {
        const price = parseFloat(variant.price);
        if (!isNaN(price)) {
          if (price > MAX_REASONABLE_PRICE) {
            issues.push(
              warning(
                "SUSPICIOUS_HIGH_PRICE",
                `Price $${variant.price} seems unusually high`,
                product.sourceKey,
                "price",
              ),
            );
          } else if (price > 0 && price < MIN_REASONABLE_PRICE) {
            issues.push(
              warning(
                "SUSPICIOUS_LOW_PRICE",
                `Price $${variant.price} seems unusually low`,
                product.sourceKey,
                "price",
              ),
            );
          }
        }
      }

      // Empty option value
      for (const [optName, optVal] of Object.entries(variant.options)) {
        if (optVal.trim() === "") {
          issues.push(
            warning(
              "EMPTY_OPTION",
              `Option "${optName}" has an empty value`,
              product.sourceKey,
              optName,
            ),
          );
        }
      }
    }

    // Image URL syntax check
    for (const image of product.images) {
      if (!URL_SYNTAX_RE.test(image.sourceUrl)) {
        issues.push(
          warning(
            "INVALID_IMAGE_URL",
            `Image URL "${image.sourceUrl}" does not look like a valid URL`,
            product.sourceKey,
            "image",
          ),
        );
      }
    }
  }

  // Duplicate SKUs
  for (const [sku, sourceKeys] of seenSkus) {
    if (sourceKeys.length > 1) {
      issues.push(
        warning(
          "DUPLICATE_SKU",
          `SKU "${sku}" appears in ${sourceKeys.length} products: ${sourceKeys.join(", ")}`,
          undefined,
          "sku",
        ),
      );
    }
  }

  // Duplicate barcodes
  for (const [barcode, sourceKeys] of seenBarcodes) {
    if (sourceKeys.length > 1) {
      issues.push(
        warning(
          "DUPLICATE_BARCODE",
          `Barcode "${barcode}" appears in ${sourceKeys.length} products: ${sourceKeys.join(", ")}`,
          undefined,
          "barcode",
        ),
      );
    }
  }

  return summarize(issues, autoFixedCount);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blocking(
  code: string,
  message: string,
  sourceKey?: string,
  field?: string,
): CatalogIssue {
  return { severity: "blocking", code, message, sourceKey, field };
}

function warning(
  code: string,
  message: string,
  sourceKey?: string,
  field?: string,
): CatalogIssue {
  return { severity: "warning", code, message, sourceKey, field };
}

function summarize(
  issues: CatalogIssue[],
  autoFixedCount: number,
): ValidationResult {
  return {
    issues,
    blockingCount: issues.filter((i) => i.severity === "blocking").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    infoCount: issues.filter((i) => i.severity === "info").length,
    autoFixedCount,
  };
}
