/**
 * Field mapping types — Section 8 of the spec.
 */

// ---------------------------------------------------------------------------
// Target fields the mapping engine can resolve to
// ---------------------------------------------------------------------------

export type TargetField =
  | "product.title"
  | "product.description"
  | "product.vendor"
  | "product.productType"
  | "product.tags"
  | "variant.sku"
  | "variant.barcode"
  | "variant.price"
  | "variant.compareAtPrice"
  | "variant.cost"
  | "variant.inventoryQuantity"
  | "variant.weight"
  | "variant.weightUnit"
  | "variant.option1"
  | "variant.option2"
  | "variant.option3"
  | "variant.option1Name"
  | "variant.option2Name"
  | "variant.option3Name"
  | "image.url"
  | "image.altText"
  | "grouping.parentKey"
  | "ignore";

// ---------------------------------------------------------------------------
// Mapping confidence
// ---------------------------------------------------------------------------

export type MappingConfidence = "high" | "medium" | "low";

export type MappingSource = "rule" | "model" | "user";

// ---------------------------------------------------------------------------
// A single column → field mapping
// ---------------------------------------------------------------------------

export type FieldMapping = {
  sourceColumn: string;
  targetField: TargetField | null;
  confidence: MappingConfidence;
  mappingSource: MappingSource;
  /** If true, column is intentionally excluded from import */
  ignored: boolean;
};

// ---------------------------------------------------------------------------
// Inferred column type (Section 8.2)
// ---------------------------------------------------------------------------

export type InferredColumnType =
  | "currency"
  | "integer"
  | "decimal"
  | "url"
  | "barcode"
  | "boolean"
  | "text"
  | "category"
  | "unknown";
