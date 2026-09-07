/**
 * Validation Engine — Section 10
 *
 * Validates a catalog after mapping and grouping, producing
 * blocking issues, warnings, and info-level messages.
 */

import type { CatalogProduct, CatalogIssue, IssueSeverity, SkuSource } from "@shared/types/catalog.js";

export type SkuCoverage = {
  /** Total variant count across all products */
  totalVariants: number;
  /** Variants that have a supplier- or merchant-provided SKU */
  withSku: number;
  /** Variants missing a SKU */
  missingSku: number;
  /** Variants with a StoreDelivery-generated SKU */
  generatedSku: number;
  /** Number of duplicate SKUs found */
  duplicateSkus: number;
  /** Number of products affected by missing SKUs */
  productsAffected: number;
};

export type ValidationResult = {
  issues: CatalogIssue[];
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  autoFixedCount: number;
  /** SKU coverage summary for the catalog */
  skuCoverage: SkuCoverage;
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
    return summarize(issues, autoFixedCount, emptyCoverage());
  }

  // Track SKUs and barcodes for duplicate detection
  const seenSkus = new Map<string, string[]>(); // sku → sourceKeys
  const seenBarcodes = new Map<string, string[]>(); // barcode → sourceKeys

  // SKU coverage tracking
  let totalVariants = 0;
  let withSku = 0;
  let missingSku = 0;
  let generatedSku = 0;
  const missingSkuProducts = new Set<string>();

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

    // Track per-product missing SKU count for aggregation
    let productMissingSkuCount = 0;

    for (const variant of product.variants) {
      totalVariants++;

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

      // --- SKU tracking ---
      const skuPresent = variant.sku != null && variant.sku.trim() !== "";
      const source: SkuSource = variant.skuSource ?? (skuPresent ? "SUPPLIER" : "NONE");

      if (skuPresent) {
        if (source === "STOREDELIVERY_GENERATED") {
          generatedSku++;
        } else {
          withSku++;
        }
      } else {
        missingSku++;
        productMissingSkuCount++;
      }

      // Track SKU for duplicates
      if (skuPresent) {
        const key = variant.sku!.toLowerCase().trim();
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

      // --- Warnings ---

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

    // Aggregate MISSING_SKU: one issue per product, not per variant
    if (productMissingSkuCount > 0) {
      missingSkuProducts.add(product.sourceKey);
      const variantLabel = productMissingSkuCount === 1 ? "variant" : "variants";
      issues.push(
        warning(
          "MISSING_SKU",
          `${productMissingSkuCount} ${variantLabel} missing a SKU`,
          product.sourceKey,
          "sku",
        ),
      );
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
  let duplicateSkuCount = 0;
  for (const [sku, sourceKeys] of seenSkus) {
    if (sourceKeys.length > 1) {
      duplicateSkuCount++;
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

  const skuCoverage: SkuCoverage = {
    totalVariants,
    withSku,
    missingSku,
    generatedSku,
    duplicateSkus: duplicateSkuCount,
    productsAffected: missingSkuProducts.size,
  };

  return summarize(issues, autoFixedCount, skuCoverage);
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
  skuCoverage: SkuCoverage,
): ValidationResult {
  return {
    issues,
    blockingCount: issues.filter((i) => i.severity === "blocking").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    infoCount: issues.filter((i) => i.severity === "info").length,
    autoFixedCount,
    skuCoverage,
  };
}

function emptyCoverage(): SkuCoverage {
  return {
    totalVariants: 0,
    withSku: 0,
    missingSku: 0,
    generatedSku: 0,
    duplicateSkus: 0,
    productsAffected: 0,
  };
}
