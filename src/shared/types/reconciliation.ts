/**
 * Reconciliation types — stateful catalog mapping & classification.
 *
 * These types define the reconciliation layer between supplier catalog
 * data and Shopify. They are intentionally independent of Prisma models
 * so the engine layer stays pure.
 */

// ---------------------------------------------------------------------------
// Mapping status
// ---------------------------------------------------------------------------

/** Status of a source→Shopify mapping. */
export type MappingStatus =
  | "MAPPED"           // durable relationship already exists
  | "CANDIDATE_MATCH"  // strong likely match; merchant confirmation may be required
  | "AMBIGUOUS"        // multiple plausible matches or conflicting evidence
  | "UNMAPPED";        // no existing relationship or credible candidate

// ---------------------------------------------------------------------------
// Reconciliation classification
// ---------------------------------------------------------------------------

/** Classification of a source product during reconciliation. */
export type ReconciliationClassification =
  | "EXISTING_MAPPED"  // persisted mapping exists — known product
  | "LIKELY_EXISTING"  // strong Shopify match found (bootstrap)
  | "NEW_PRODUCT"      // no match — candidate for creation
  | "NEEDS_REVIEW"     // ambiguous or low-confidence match
  | "UPDATE_REVIEW"    // mapped product with field-level changes
  | "NO_CHANGE";       // re-upload of identical data

// ---------------------------------------------------------------------------
// Proposed action
// ---------------------------------------------------------------------------

/** What StoreDelivery proposes to do with a classified product. */
export type ProposedAction =
  | "CREATE_PRODUCT"
  | "CREATE_VARIANT"
  | "UPDATE_PRODUCT"
  | "LINK_EXISTING_PRODUCT"
  | "LINK_EXISTING_VARIANT"
  | "NO_CHANGE"
  | "SKIP";

// ---------------------------------------------------------------------------
// Match confidence
// ---------------------------------------------------------------------------

export type MatchConfidence = "HIGH" | "MEDIUM" | "LOW";

// ---------------------------------------------------------------------------
// Match evidence
// ---------------------------------------------------------------------------

/** A single piece of evidence supporting a match. */
export type MatchEvidence = {
  type: "sku" | "barcode" | "mpn" | "vendor_title" | "option_structure" | "persisted_mapping";
  sourceValue: string;
  shopifyValue?: string;
  shopifyProductId?: string;
  shopifyVariantId?: string;
  confidence: MatchConfidence;
};

// ---------------------------------------------------------------------------
// Product classification result
// ---------------------------------------------------------------------------

/** Classification result for a single source product. */
export type ProductClassification = {
  sourceProductKey: string;
  classification: ReconciliationClassification;
  proposedAction: ProposedAction;
  /** The Shopify product ID this source maps to (if any). */
  matchedShopifyProductId: string | null;
  /** Existing ProductMapping ID (if any). */
  productMappingId: string | null;
  confidence: MatchConfidence | null;
  matchEvidence: MatchEvidence[];
};

// ---------------------------------------------------------------------------
// Reconciliation summary
// ---------------------------------------------------------------------------

/** Aggregate summary of a reconciliation run. */
export type ReconciliationSummary = {
  totalProducts: number;
  existingMapped: number;
  likelyExisting: number;
  newProducts: number;
  needsReview: number;
  noChange: number;
};

// ---------------------------------------------------------------------------
// Existing mapping (from DB, passed to engine)
// ---------------------------------------------------------------------------

/** A persisted product-level mapping, loaded from DB for the engine. */
export type PersistedProductMapping = {
  id: string;
  sourceProductKey: string;
  sourceProductFingerprint: string;
  shopifyProductId: string | null;
  mappingStatus: MappingStatus;
  /** Variant mappings under this product. */
  variants: PersistedVariantMapping[];
};

/** A persisted variant-level mapping. */
export type PersistedVariantMapping = {
  id: string;
  sourceVariantKey: string;
  sourceVariantFingerprint: string;
  shopifyVariantId: string | null;
  sourceSku: string | null;
  barcode: string | null;
  shopifySku: string | null;
  skuSource: string;
};

// ---------------------------------------------------------------------------
// Shopify identity index (for bootstrap matching)
// ---------------------------------------------------------------------------

/** Shopify store identifiers, pre-fetched for matching. */
export type ShopifyIdentityIndex = {
  /** lowercase SKU → all matching Shopify variants (may have duplicates across products) */
  skus: Map<string, Array<{ productId: string; variantId: string }>>;
  /** lowercase barcode → all matching Shopify variants */
  barcodes: Map<string, Array<{ productId: string; variantId: string }>>;
  /** lowercase title → shopifyProductId */
  titles: Map<string, string>;
};

// ---------------------------------------------------------------------------
// Field-level diff (for update review)
// ---------------------------------------------------------------------------

/** A single field change detected between supplier data and Shopify. */
export type FieldChange = {
  field: string;
  shopifyValue: string | null;
  supplierValue: string | null;
  /** Whether the merchant has selected this change for application. Default: true */
  selected: boolean;
};

/** Diff for a single variant within a product. */
export type VariantDiff = {
  sourceVariantKey: string;
  shopifyVariantId: string | null;
  changes: FieldChange[];
};

/** Full diff for a product: product-level + variant-level changes. */
export type ProductDiff = {
  sourceProductKey: string;
  shopifyProductId: string;
  hasChanges: boolean;
  productChanges: FieldChange[];
  variantChanges: VariantDiff[];
};

// ---------------------------------------------------------------------------
// Shopify snapshot types (for diff engine input — no Prisma dependency)
// ---------------------------------------------------------------------------

/** Product snapshot fields needed for diff computation. */
export type SnapshotProduct = {
  shopifyProductId: string;
  title: string;
  description: string | null;
  handle: string | null;
  vendor: string | null;
  productType: string | null;
  status: string | null;
  tags: string[];
  images: Array<{ url: string; altText: string | null }>;
};

/** Variant snapshot fields needed for diff computation. */
export type SnapshotVariant = {
  shopifyVariantId: string;
  shopifyProductId: string;
  /** Shopify InventoryItem GID — needed for inventoryItemUpdate and inventorySetOnHandQuantities mutations. */
  inventoryItemId: string | null;
  sku: string | null;
  barcode: string | null;
  price: string | null;
  compareAtPrice: string | null;
  cost: string | null;
  inventoryQuantity: number | null;
  inventoryPolicy: string | null;
  taxable: boolean | null;
  weight: number | null;
  weightUnit: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
};
