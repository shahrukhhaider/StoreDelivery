/**
 * Canonical data model — Section 5 of the spec.
 *
 * These types are the internal representation that every layer works with.
 * They are intentionally independent of Shopify API objects so the parser
 * and canonical model can later support non-Shopify targets.
 */

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type CatalogFormat = "csv" | "xlsx";

export type CatalogSource = {
  fileName: string;
  format: CatalogFormat;
  /** XLSX sheet name, if applicable */
  sheet?: string;
  /** Hash of detected headers/structure for dedup and saved-mapping lookup */
  schemaFingerprint: string;
};

export type Catalog = {
  id: string;
  shopId: string;
  uploadId: string;
  source: CatalogSource;
  products: CatalogProduct[];
  issues: CatalogIssue[];
};

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export type CatalogProduct = {
  /** Supplier-side identifier — row key, SKU, or parent ID */
  sourceKey: string;
  title: string;
  description?: string;
  vendor?: string;
  productType?: string;
  tags: string[];
  variants: CatalogVariant[];
  images: CatalogImage[];
  /** Raw row data preserved for debugging and future diff/reconciliation */
  sourceData: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Variant
// ---------------------------------------------------------------------------

export type CatalogVariant = {
  sourceKey: string;
  sku?: string;
  barcode?: string;
  /** e.g. { "Color": "Red", "Size": "M" } */
  options: Record<string, string>;
  price?: string;
  compareAtPrice?: string;
  cost?: string;
  inventoryQuantity?: number;
  weight?: number;
  weightUnit?: string;
  sourceData: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export type CatalogImage = {
  sourceUrl: string;
  /** Links image to a specific variant if applicable */
  variantSourceKey?: string;
  position?: number;
  altText?: string;
};

// ---------------------------------------------------------------------------
// Issues (validation output)
// ---------------------------------------------------------------------------

export type IssueSeverity = "blocking" | "warning" | "info";

export type CatalogIssue = {
  severity: IssueSeverity;
  code: string;
  message: string;
  /** Which product/row the issue relates to (undefined = catalog-level) */
  sourceKey?: string;
  /** Which field triggered the issue */
  field?: string;
};
