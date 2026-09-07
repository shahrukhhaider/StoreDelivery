/**
 * SKU Generation Engine
 *
 * Generates SKUs from a format template for variants that are missing them.
 * Never auto-applies — generation is an explicit merchant action.
 *
 * V1 supported tokens:
 *   {productHandle}  — the product's sourceKey / handle
 *   {variantIndex}   — 1-based index, zero-padded per format (e.g. :003 → "001")
 *
 * Future tokens (reserved, not yet implemented):
 *   {vendor}, {productIndex}, {option1}, {option2}, {sourceField:*}
 */

import type { CatalogProduct, SkuSource } from "@shared/types/catalog.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkuFormatToken = "productHandle" | "variantIndex";

export type GeneratedSku = {
  productSourceKey: string;
  variantIndex: number;
  variantSourceKey: string;
  sku: string;
  skuSource: SkuSource;
};

export type SkuCollision = {
  generatedSku: string;
  productSourceKey: string;
  variantIndex: number;
  /** The existing owner — could be a product in the catalog or a Shopify variant description */
  collidesWithDescription: string;
  collisionType: "catalog" | "shopify";
};

export type SkuGenerationResult = {
  generated: GeneratedSku[];
  collisions: SkuCollision[];
  /** Total variants that needed SKUs */
  totalMissing: number;
  /** Successfully generated (no collision) */
  successCount: number;
  /** Blocked by collision */
  collisionCount: number;
};

export type SkuGenerationOptions = {
  /** Format template, e.g. "{productHandle}-{variantIndex:003}" */
  format: string;
  /** Existing SKUs already in this catalog (lowercase → sourceKey) */
  existingCatalogSkus?: Map<string, string>;
  /** Existing Shopify store SKUs (lowercase → description like "Product / Variant") */
  existingShopifySkus?: Map<string, string>;
  /** Only generate for these product sourceKeys (undefined = all missing) */
  filterSourceKeys?: Set<string>;
};

// Default format
export const DEFAULT_SKU_FORMAT = "{productHandle}-{variantIndex:003}";

// ---------------------------------------------------------------------------
// Token parser
// ---------------------------------------------------------------------------

/**
 * Parse a format string into segments for fast expansion.
 * E.g. "{productHandle}-{variantIndex:003}" → [
 *   { type: "token", token: "productHandle" },
 *   { type: "literal", value: "-" },
 *   { type: "token", token: "variantIndex", pad: 3 },
 * ]
 */
type FormatSegment =
  | { type: "literal"; value: string }
  | { type: "token"; token: SkuFormatToken; pad?: number };

function parseFormat(format: string): FormatSegment[] {
  const segments: FormatSegment[] = [];
  const re = /\{(\w+)(?::(\d+))?\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(format)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "literal", value: format.slice(lastIndex, match.index) });
    }
    const token = match[1] as SkuFormatToken;
    const padStr = match[2];
    const pad = padStr ? padStr.length : undefined;
    segments.push({ type: "token", token, pad });
    lastIndex = re.lastIndex;
  }

  if (lastIndex < format.length) {
    segments.push({ type: "literal", value: format.slice(lastIndex) });
  }

  return segments;
}

/**
 * Sanitize a product handle for use in SKUs:
 * lowercase, replace non-alphanumeric with hyphens, collapse hyphens, trim.
 */
function sanitizeHandle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80); // reasonable length limit
}

/**
 * Expand a format template for a single variant.
 */
function expandFormat(
  segments: FormatSegment[],
  productHandle: string,
  variantIndex: number,
): string {
  return segments
    .map((seg) => {
      if (seg.type === "literal") return seg.value;
      switch (seg.token) {
        case "productHandle":
          return sanitizeHandle(productHandle);
        case "variantIndex": {
          const padLen = seg.pad ?? 3;
          return String(variantIndex).padStart(padLen, "0");
        }
        default:
          return `{${seg.token}}`;
      }
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * Generate a preview of what SKUs would look like for up to `count` samples.
 */
export function previewSkus(
  products: CatalogProduct[],
  format: string,
  count = 3,
): string[] {
  const segments = parseFormat(format);
  const previews: string[] = [];

  for (const product of products) {
    for (let vi = 0; vi < product.variants.length; vi++) {
      const variant = product.variants[vi];
      const hasSku = variant.sku != null && variant.sku.trim() !== "";
      if (hasSku) continue;

      previews.push(
        expandFormat(segments, product.sourceKey, vi + 1),
      );
      if (previews.length >= count) return previews;
    }
  }

  return previews;
}

// ---------------------------------------------------------------------------
// Full generation with collision detection
// ---------------------------------------------------------------------------

/**
 * Generate SKUs for all variants missing them across the given products.
 *
 * Steps:
 * 1. Trim whitespace from format.
 * 2. For each product/variant without a SKU, expand the template.
 * 3. Reject blank results.
 * 4. Check uniqueness within the generated batch.
 * 5. Check collision with existing catalog SKUs.
 * 6. Check collision with existing Shopify SKUs.
 * 7. Never touch variants that already have a SKU.
 */
export function generateSkus(
  products: CatalogProduct[],
  options: SkuGenerationOptions,
): SkuGenerationResult {
  const format = options.format.trim();
  if (!format) {
    return { generated: [], collisions: [], totalMissing: 0, successCount: 0, collisionCount: 0 };
  }

  const segments = parseFormat(format);
  const existingCatalog = options.existingCatalogSkus ?? new Map<string, string>();
  const existingShopify = options.existingShopifySkus ?? new Map<string, string>();
  const filterKeys = options.filterSourceKeys;

  const generated: GeneratedSku[] = [];
  const collisions: SkuCollision[] = [];

  // Track all generated SKUs within this batch for internal uniqueness
  const batchSkus = new Map<string, { productSourceKey: string; variantIndex: number }>();

  let totalMissing = 0;

  for (const product of products) {
    if (filterKeys && !filterKeys.has(product.sourceKey)) continue;

    for (let vi = 0; vi < product.variants.length; vi++) {
      const variant = product.variants[vi];
      const hasSku = variant.sku != null && variant.sku.trim() !== "";

      // Preserve existing source SKUs unchanged
      if (hasSku) continue;

      totalMissing++;

      const raw = expandFormat(segments, product.sourceKey, vi + 1);
      const sku = raw.trim();

      // Reject blank result
      if (!sku) {
        collisions.push({
          generatedSku: "(blank)",
          productSourceKey: product.sourceKey,
          variantIndex: vi,
          collidesWithDescription: "Generated SKU is blank after expansion",
          collisionType: "catalog",
        });
        continue;
      }

      const skuLower = sku.toLowerCase();

      // Check against existing catalog SKUs
      const catalogOwner = existingCatalog.get(skuLower);
      if (catalogOwner) {
        collisions.push({
          generatedSku: sku,
          productSourceKey: product.sourceKey,
          variantIndex: vi,
          collidesWithDescription: catalogOwner,
          collisionType: "catalog",
        });
        continue;
      }

      // Check against existing Shopify SKUs
      const shopifyOwner = existingShopify.get(skuLower);
      if (shopifyOwner) {
        collisions.push({
          generatedSku: sku,
          productSourceKey: product.sourceKey,
          variantIndex: vi,
          collidesWithDescription: shopifyOwner,
          collisionType: "shopify",
        });
        continue;
      }

      // Check within this generation batch
      const batchOwner = batchSkus.get(skuLower);
      if (batchOwner) {
        collisions.push({
          generatedSku: sku,
          productSourceKey: product.sourceKey,
          variantIndex: vi,
          collidesWithDescription: `${batchOwner.productSourceKey} / variant ${batchOwner.variantIndex + 1}`,
          collisionType: "catalog",
        });
        continue;
      }

      // No collision — record it
      batchSkus.set(skuLower, { productSourceKey: product.sourceKey, variantIndex: vi });
      generated.push({
        productSourceKey: product.sourceKey,
        variantIndex: vi,
        variantSourceKey: variant.sourceKey,
        sku,
        skuSource: "STOREDELIVERY_GENERATED",
      });
    }
  }

  return {
    generated,
    collisions,
    totalMissing,
    successCount: generated.length,
    collisionCount: collisions.length,
  };
}

/**
 * Collect all existing SKUs from a list of catalog products.
 * Returns a map of lowercase SKU → "ProductTitle / VariantSKU" for display.
 */
export function collectCatalogSkus(products: CatalogProduct[]): Map<string, string> {
  const skus = new Map<string, string>();
  for (const product of products) {
    for (const variant of product.variants) {
      if (variant.sku && variant.sku.trim()) {
        const key = variant.sku.toLowerCase().trim();
        const desc = `${product.title || product.sourceKey} / ${variant.sku}`;
        if (!skus.has(key)) {
          skus.set(key, desc);
        }
      }
    }
  }
  return skus;
}
