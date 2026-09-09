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

// Shopify hard limits
const MAX_OPTIONS_PER_PRODUCT = 3;
const MAX_VARIANTS_PER_PRODUCT = 100;
const MAX_TITLE_LENGTH = 255;
const MAX_OPTION_VALUE_LENGTH = 255;

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

    // Multi-variant product without options — Shopify requires unique option
    // values to distinguish variants. Without mapped option columns, all
    // variants are indistinguishable and creation will fail.
    if (product.variants.length > 1) {
      const hasAnyOptions = product.variants.some(
        (v) => Object.values(v.options).some((val) => val && val.trim() !== ""),
      );
      if (!hasAnyOptions) {
        issues.push(
          blocking(
            "MISSING_OPTIONS",
            `Product has ${product.variants.length} variants but no option values (e.g. Color, Size) to distinguish them. Map an option column or reduce to one variant.`,
            product.sourceKey,
            "options",
          ),
        );
      }
    }

    // Too many options — Shopify allows max 3 option names per product
    const optionNames = new Set<string>();
    for (const v of product.variants) {
      for (const key of Object.keys(v.options)) {
        if (v.options[key]?.trim()) optionNames.add(key);
      }
    }
    if (optionNames.size > MAX_OPTIONS_PER_PRODUCT) {
      issues.push(
        blocking(
          "TOO_MANY_OPTIONS",
          `Product has ${optionNames.size} option types (${[...optionNames].join(", ")}), but Shopify allows a maximum of ${MAX_OPTIONS_PER_PRODUCT}`,
          product.sourceKey,
          "options",
        ),
      );
    }

    // Too many variants — Shopify allows max 100 variants per product
    if (product.variants.length > MAX_VARIANTS_PER_PRODUCT) {
      issues.push(
        blocking(
          "TOO_MANY_VARIANTS",
          `Product has ${product.variants.length} variants, but Shopify allows a maximum of ${MAX_VARIANTS_PER_PRODUCT}`,
          product.sourceKey,
          "variants",
        ),
      );
    }

    // Title too long — Shopify max 255 characters
    if (product.title && product.title.length > MAX_TITLE_LENGTH) {
      issues.push(
        blocking(
          "TITLE_TOO_LONG",
          `Title is ${product.title.length} characters, but Shopify allows a maximum of ${MAX_TITLE_LENGTH}`,
          product.sourceKey,
          "title",
        ),
      );
    }

    // Duplicate option value combinations — Shopify rejects two variants
    // with identical option values (e.g. two "Red / M" variants)
    if (product.variants.length > 1) {
      const seenCombos = new Set<string>();
      for (const v of product.variants) {
        const combo = Object.entries(v.options)
          .filter(([, val]) => val?.trim())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => `${k}=${val.trim().toLowerCase()}`)
          .join("|");
        if (combo && seenCombos.has(combo)) {
          issues.push(
            blocking(
              "DUPLICATE_OPTION_VALUES",
              `Two variants have identical options (${combo.replace(/\|/g, ", ")}). Each variant must have a unique option combination.`,
              product.sourceKey,
              "options",
            ),
          );
          break; // one per product is enough
        }
        if (combo) seenCombos.add(combo);
      }
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
        } else if (price < 0) {
          issues.push(
            blocking(
              "NEGATIVE_PRICE",
              `Price ${variant.price} is negative — Shopify requires price >= 0`,
              product.sourceKey,
              "price",
            ),
          );
        }
      }

      // Option value length — Shopify max 255 characters per option value
      for (const [optName, optVal] of Object.entries(variant.options)) {
        if (optVal && optVal.length > MAX_OPTION_VALUE_LENGTH) {
          issues.push(
            blocking(
              "OPTION_VALUE_TOO_LONG",
              `Option "${optName}" value is ${optVal.length} characters (max ${MAX_OPTION_VALUE_LENGTH})`,
              product.sourceKey,
              optName,
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
