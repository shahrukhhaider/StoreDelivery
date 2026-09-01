/**
 * Import operation types — Sections 13–17 of the spec.
 */

// ---------------------------------------------------------------------------
// Import plan (immutable, persisted before execution)
// ---------------------------------------------------------------------------

export type ImportPlan = {
  catalogId: string;
  shopId: string;
  idempotencyKey: string;
  productCount: number;
  variantCount: number;
  imageCount: number;
  skippedDuplicateCount: number;
  /** Product source keys included in this import */
  includedKeys: string[];
  /** Product source keys excluded (duplicates, user choice) */
  excludedKeys: string[];
};

// ---------------------------------------------------------------------------
// Import operation status
// ---------------------------------------------------------------------------

export type ImportOperationStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export type ImportItemStatus =
  | "pending"
  | "success"
  | "failed"
  | "skipped";

export type ImportItemAction = "create" | "skip";

// ---------------------------------------------------------------------------
// Import item result
// ---------------------------------------------------------------------------

export type ImportItemResult = {
  sourceProductKey: string;
  action: ImportItemAction;
  status: ImportItemStatus;
  shopifyProductId?: string;
  errorCode?: string;
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// Import summary (displayed after completion)
// ---------------------------------------------------------------------------

export type ImportSummary = {
  total: number;
  created: number;
  failed: number;
  skipped: number;
};
