/**
 * API client — fetch wrapper with error handling for the server API.
 *
 * When running inside Shopify (App Bridge), fetches the session token
 * and sends it as a Bearer header. Falls back to dev-mode X-Shop-Id.
 */

const API_BASE = "/api";

/**
 * Get the Shopify App Bridge session token if available.
 * App Bridge exposes this via `shopify.idToken()` on the global object.
 */
async function getSessionToken(): Promise<string | null> {
  try {
    // @ts-expect-error — shopify is injected by App Bridge in embedded mode
    if (typeof shopify !== "undefined" && shopify.idToken) {
      // @ts-expect-error
      return await shopify.idToken();
    }
  } catch {
    // Not in embedded mode
  }
  return null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const token = await getSessionToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    headers["X-Shop-Id"] = "dev_shop";
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      body.error ?? "UNKNOWN",
      body.message ?? `Request failed: ${res.status}`,
    );
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export type UploadResponse = {
  id: string;
  fileName: string;
  format: string;
  status: string;
  catalogId?: string | null;
  createdAt?: string;
};

export async function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);

  const headers: Record<string, string> = {};
  const token = await getSessionToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    headers["X-Shop-Id"] = "dev_shop";
  }

  const res = await fetch(`${API_BASE}/uploads`, {
    method: "POST",
    headers,
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? "UNKNOWN", body.message ?? "Upload failed");
  }

  return res.json();
}

export async function getUpload(id: string): Promise<UploadResponse> {
  return request(`/uploads/${id}`);
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type CatalogSummary = {
  id: string;
  shopId: string;
  uploadId: string;
  fileName: string;
  format: string;
  schemaFingerprint: string;
  productCount: number;
  mappingCount: number;
  statusCounts: { ready: number; needs_review: number; blocked: number; pending: number };
  issueCounts: { blocking: number; warning: number; info: number };
  createdAt: string;
};

export async function getCatalog(id: string): Promise<CatalogSummary> {
  return request(`/catalogs/${id}`);
}

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------

export type MappingItem = {
  id: string;
  sourceColumn: string;
  targetField: string | null;
  confidence: string;
  mappingSource: string;
  ignored: boolean;
};

export type MappingsResponse = {
  catalogId: string;
  mappings: MappingItem[];
};

export async function getMappings(catalogId: string): Promise<MappingsResponse> {
  return request(`/catalogs/${catalogId}/mappings`);
}

export type MappingUpdate = {
  sourceColumn: string;
  targetField: string | null;
  ignored: boolean;
};

export async function updateMappings(
  catalogId: string,
  mappings: MappingUpdate[],
): Promise<{ catalogId: string; productCount: number; issueCount: number; mappingCount: number }> {
  return request(`/catalogs/${catalogId}/mappings`, {
    method: "PUT",
    body: JSON.stringify({ mappings }),
  });
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export type ProductListItem = {
  id: string;
  sourceKey: string;
  status: string;
  title: string;
  vendor?: string;
  productType?: string;
  variantCount: number;
  imageCount: number;
  firstSku?: string | null;
  firstPrice?: string | null;
  tags: string[];
};

export type ProductsResponse = {
  catalogId: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  products: ProductListItem[];
};

export async function getProducts(
  catalogId: string,
  page = 1,
  pageSize = 20,
): Promise<ProductsResponse> {
  return request(`/catalogs/${catalogId}/products?page=${page}&pageSize=${pageSize}`);
}

export async function getProductDetail(catalogId: string, productId: string) {
  return request<{ id: string; sourceKey: string; status: string; data: unknown }>(
    `/catalogs/${catalogId}/products/${productId}`,
  );
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export type IssueItem = {
  sourceKey: string | null;
  code: string;
  message: string;
  field: string | null;
};

export type IssuesResponse = {
  blocking: IssueItem[];
  warning: IssueItem[];
  summary: {
    total: number;
    ready: number;
    needsReview: number;
    blocked: number;
    blockingCount?: number;
    warningCount?: number;
  };
};

export async function getIssues(catalogId: string): Promise<IssuesResponse> {
  return request(`/catalogs/${catalogId}/issues`);
}

// ---------------------------------------------------------------------------
// Import Plan
// ---------------------------------------------------------------------------

export type PlanResponse = {
  id: string;
  status: string;
  productCount: number;
  variantCount: number;
  imageCount: number;
  skippedCount?: number;
  successCount?: number;
  failedCount?: number;
  idempotencyKey?: string;
  existing?: boolean;
  createdAt?: string;
  completedAt?: string | null;
};

export async function createPlan(catalogId: string): Promise<PlanResponse> {
  return request(`/catalogs/${catalogId}/plan`, { method: "POST" });
}

export async function getPlan(catalogId: string): Promise<PlanResponse> {
  return request(`/catalogs/${catalogId}/plan`);
}

// ---------------------------------------------------------------------------
// Import Operations
// ---------------------------------------------------------------------------

export type ImportStatus = {
  id: string;
  status: string;
  fileName?: string;
  fileFormat?: string;
  catalogId?: string;
  plannedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  progress: number;
  elapsedMs?: number;
  createdAt?: string;
  completedAt?: string | null;
  uploadedAt?: string;
};

export async function executeImport(operationId: string): Promise<{ id: string; status: string }> {
  return request(`/imports/${operationId}/execute`, { method: "POST" });
}

export async function getImportStatus(operationId: string): Promise<ImportStatus> {
  return request(`/imports/${operationId}`);
}

export type ImportItemEntry = {
  id: string;
  sourceProductKey: string;
  action: string;
  status: string;
  shopifyProductId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type ImportItemsResponse = {
  operationId: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: ImportItemEntry[];
};

export async function getImportItems(
  operationId: string,
  page = 1,
  statusFilter?: string,
): Promise<ImportItemsResponse> {
  let url = `/imports/${operationId}/items?page=${page}`;
  if (statusFilter) url += `&status=${statusFilter}`;
  return request(url);
}

export async function retryImport(operationId: string): Promise<{ id: string; status: string }> {
  return request(`/imports/${operationId}/retry`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export type HistoryEntry = {
  uploadId: string;
  fileName: string;
  format: string;
  uploadStatus: string;
  createdAt: string;
  catalogId: string | null;
  productCount: number;
  operationId: string | null;
  importStatus: string | null;
  plannedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  completedAt: string | null;
  startedAt: string | null;
};

export async function getHistory(): Promise<{ history: HistoryEntry[] }> {
  return request("/history");
}

// ---------------------------------------------------------------------------
// Inline Edit API
// ---------------------------------------------------------------------------

// Issues (enhanced)
export type EditIssue = {
  code: string;
  message: string;
  severity: string;
  sourceKey: string | null;
  field: string | null;
  type: string;
};

export type EditIssueSummary = {
  total: number;
  blocking: number;
  warning: number;
  info: number;
  autoFixed: number;
  overrideCount: number;
};

export type EditIssuesResponse = {
  issues: EditIssue[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: EditIssueSummary;
  typeCounts: Record<string, number>;
  severityCounts: Record<string, number>;
};

export async function getEditIssues(
  catalogId: string,
  options?: { type?: string; severity?: string; page?: number; pageSize?: number },
): Promise<EditIssuesResponse> {
  const params = new URLSearchParams();
  if (options?.type) params.set("type", options.type);
  if (options?.severity) params.set("severity", options.severity);
  if (options?.page) params.set("page", String(options.page));
  if (options?.pageSize) params.set("pageSize", String(options.pageSize));
  const qs = params.toString();
  return request(`/catalogs/${catalogId}/edit/issues${qs ? `?${qs}` : ""}`);
}

// Single product edit
export type ProductEditResult = {
  productId: string;
  sourceKey: string;
  source: unknown;
  resolved: unknown;
  overrides: Array<{ id: string; field: string; oldValue: unknown; newValue: unknown }>;
  issues: Array<{ severity: string; code: string; message: string }>;
  diff: Array<{ field: string; oldValue: unknown; newValue: unknown }>;
};

export async function editProduct(
  catalogId: string,
  productId: string,
  edits: Array<{ field: string; value: unknown }>,
): Promise<ProductEditResult> {
  return request(`/catalogs/${catalogId}/edit/products/${productId}`, {
    method: "PATCH",
    body: JSON.stringify({ edits }),
  });
}

// Bulk edit
export type BulkEditResult = {
  affected: number;
  invalid: number;
  total: number;
};

export async function bulkEdit(
  catalogId: string,
  action: "set_value" | "replace_value" | "clear_value",
  field: string,
  value?: unknown,
  filter?: { status?: string; sourceKeys?: string[] },
  replaceFrom?: string,
): Promise<BulkEditResult> {
  return request(`/catalogs/${catalogId}/edit/bulk`, {
    method: "POST",
    body: JSON.stringify({ action, field, value, replaceFrom, filter }),
  });
}

// Auto-fix
export type AutoFixResult = {
  totalFixed: number;
  breakdown: Record<string, number>;
  totalProducts: number;
};

export async function runAutoFix(catalogId: string): Promise<AutoFixResult> {
  return request(`/catalogs/${catalogId}/edit/auto-fix`, { method: "POST" });
}

// Preview with overrides
export type PreviewProduct = {
  id: string;
  sourceKey: string;
  status: string;
  source?: unknown;
  resolved: unknown;
  hasOverrides: boolean;
  overrideCount: number;
  diff: Array<{ field: string; oldValue: unknown; newValue: unknown }>;
};

export type EditPreviewResponse = {
  catalogId: string;
  products: PreviewProduct[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  overrideStats: { productsWithOverrides: number; totalOverrides: number };
  validation: { blocking: number; warning: number; info: number };
};

export async function getEditPreview(
  catalogId: string,
  page = 1,
  pageSize = 20,
  filters?: { severity?: string; issueType?: string },
): Promise<EditPreviewResponse> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.issueType) params.set("issueType", filters.issueType);
  return request(`/catalogs/${catalogId}/edit/preview?${params.toString()}`);
}

// Undo
export async function undoOverride(catalogId: string, overrideId: string): Promise<{ status: string }> {
  return request(`/catalogs/${catalogId}/edit/overrides/${overrideId}`, { method: "DELETE" });
}

export async function clearAllOverrides(
  catalogId: string,
  source?: string,
): Promise<{ status: string; deleted: number }> {
  const qs = source ? `?source=${source}` : "";
  return request(`/catalogs/${catalogId}/edit/overrides${qs}`, { method: "DELETE" });
}

// Similar issues detection
export type SimilarIssuesResponse = {
  issueCode: string;
  affectedCount: number;
  affectedKeys: string[];
  suggestedFix: { field: string; value: string; explanation: string } | null;
  detectedFields: Array<{ label: string; value: string }>;
};

export async function findSimilarIssues(
  catalogId: string,
  issueCode: string,
  field?: string,
): Promise<SimilarIssuesResponse> {
  return request(`/catalogs/${catalogId}/edit/similar`, {
    method: "POST",
    body: JSON.stringify({ issueCode, field }),
  });
}
