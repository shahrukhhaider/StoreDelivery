/**
 * API client — fetch wrapper with error handling for the server API.
 */

const API_BASE = "/api";

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
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Shop-Id": "dev_shop",
      ...options.headers,
    },
    ...options,
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

  const res = await fetch(`${API_BASE}/uploads`, {
    method: "POST",
    headers: { "X-Shop-Id": "dev_shop" },
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

export type IssuesResponse = {
  blocking: Array<{ sourceKey: string; title: unknown }>;
  warning: Array<{ sourceKey: string; title: unknown }>;
  summary: { total: number; ready: number; needsReview: number; blocked: number };
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
