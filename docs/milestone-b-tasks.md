# Milestone B — Merchant Preview

**Goal:** Upload → mapping review → issues → preview → import plan.
**Exit criteria:** A nontechnical tester can complete the flow without assistance.

---

## Task B1: Server Foundation

**Files:** `src/server/index.ts`, `src/server/config.ts`, `src/server/db.ts`

- [ ] B1.1 — Express app setup with JSON body parsing, CORS, error handling middleware
- [ ] B1.2 — Config module loading from environment variables with validation (Zod)
- [ ] B1.3 — Prisma client singleton with connection management
- [ ] B1.4 — Health check endpoint (`GET /api/health`)
- [ ] B1.5 — Request logging middleware (winston)

---

## Task B2: File Storage Service

**File:** `src/server/storage/file-storage.ts`
**Spec:** Section 4

- [ ] B2.1 — Abstract storage interface: `upload(key, buffer)`, `download(key)`, `getSignedUrl(key)`, `delete(key)`
- [ ] B2.2 — Local filesystem implementation for development
- [ ] B2.3 — S3-compatible implementation (AWS SDK)
- [ ] B2.4 — Signed URL generation with configurable expiry
- [ ] B2.5 — File retention cleanup (configurable, default 30 days)

---

## Task B3: Upload API

**Files:** `src/server/api/upload.ts`
**Spec:** Sections 4, 7

- [ ] B3.1 — `POST /api/uploads` — accept multipart file upload (multer or busboy)
- [ ] B3.2 — Validate file type (csv/xlsx), size, and basic integrity
- [ ] B3.3 — Store raw file in storage service
- [ ] B3.4 — Create `catalog_uploads` DB record with status `pending`
- [ ] B3.5 — Enqueue parse job
- [ ] B3.6 — Return upload ID + status

---

## Task B4: Background Job System

**Files:** `src/server/jobs/queue.ts`, `src/server/jobs/worker.ts`
**Spec:** Section 4

- [ ] B4.1 — Job table schema (or reuse uploads status as implicit queue)
- [ ] B4.2 — Job processor: poll for pending uploads, parse file, run mapping pipeline
- [ ] B4.3 — Update upload status through lifecycle: `pending` → `parsing` → `parsed` / `failed`
- [ ] B4.4 — Persist catalog, field mappings, and catalog products to DB after successful parse
- [ ] B4.5 — Error handling with structured error codes stored in DB

---

## Task B5: Catalog & Mapping API

**Files:** `src/server/api/catalog.ts`, `src/server/api/mappings.ts`

- [ ] B5.1 — `GET /api/uploads/:id` — upload status + linked catalog ID when ready
- [ ] B5.2 — `GET /api/catalogs/:id` — catalog summary (product count, issue counts, source info)
- [ ] B5.3 — `GET /api/catalogs/:id/mappings` — list field mappings with confidence + review flags
- [ ] B5.4 — `PUT /api/catalogs/:id/mappings` — merchant updates mappings (re-runs grouping + validation)
- [ ] B5.5 — `GET /api/catalogs/:id/products` — paginated product list with variants, images, status
- [ ] B5.6 — `GET /api/catalogs/:id/issues` — issues grouped by severity
- [ ] B5.7 — `GET /api/catalogs/:id/plan` — import plan summary

---

## Task B6: Import Plan Generation

**File:** `src/server/api/plan.ts`
**Spec:** Section 13

- [ ] B6.1 — Generate immutable import plan from catalog (product/variant/image counts)
- [ ] B6.2 — Account for excluded products (blocked, user-deselected)
- [ ] B6.3 — Generate idempotency key from `shop_id + catalog_id + plan_hash`
- [ ] B6.4 — Persist plan to `import_operations` with status `planned`
- [ ] B6.5 — `POST /api/catalogs/:id/plan` — create plan, return plan summary

---

## Task B7: API Router & Middleware

**Files:** `src/server/api/routes.ts`, `src/server/api/middleware.ts`

- [ ] B7.1 — Mount all route modules on Express router
- [ ] B7.2 — Shop-scoped middleware (extract shop ID from session/header for tenant isolation)
- [ ] B7.3 — Input validation middleware (Zod schemas for request bodies/params)
- [ ] B7.4 — Error response formatting (consistent JSON error shape)

---

## Task B8: Web UI — Upload Page

**Files:** `src/web/pages/UploadPage.tsx`
**Spec:** Sections 4, 7, 12

- [ ] B8.1 — Polaris `DropZone` for CSV/XLSX upload
- [ ] B8.2 — File type and size validation on client
- [ ] B8.3 — Upload progress indicator
- [ ] B8.4 — Polling for parse completion, redirect to mapping review on success
- [ ] B8.5 — Error display for parse failures

---

## Task B9: Web UI — Mapping Review Page

**Files:** `src/web/pages/MappingPage.tsx`
**Spec:** Section 8

- [ ] B9.1 — Display auto-detected mappings in a table: source column → target field → confidence
- [ ] B9.2 — Color-code by confidence: high (green), medium (amber), low/unmapped (red)
- [ ] B9.3 — Dropdown to change target field for any column
- [ ] B9.4 — "Ignore" toggle for irrelevant columns
- [ ] B9.5 — Save mappings button → PUT API → re-process → navigate to preview
- [ ] B9.6 — Show sample values for each column to help merchant decide

---

## Task B10: Web UI — Preview & Issues Page

**Files:** `src/web/pages/PreviewPage.tsx`
**Spec:** Sections 10, 12, 13

- [ ] B10.1 — Summary banner: "428 products detected, 231 auto-fixed, 17 need review, 2 blocking"
- [ ] B10.2 — Issue list grouped by severity with expandable details
- [ ] B10.3 — Product table with title, vendor, type, variant count, SKU, price, image count, warnings
- [ ] B10.4 — Pagination for product list
- [ ] B10.5 — Product detail drawer/modal showing variants and images
- [ ] B10.6 — Import plan card: "This import will create X products, Y variants, Z images. Skip N duplicates."
- [ ] B10.7 — Import button disabled while blocking issues remain
- [ ] B10.8 — Confirm import action → create plan → navigate to (future) results page

---

## Task B11: App Shell & Navigation

**Files:** `src/web/App.tsx`, `src/web/main.tsx`

- [ ] B11.1 — Polaris `AppProvider` with i18n
- [ ] B11.2 — Client-side routing (React Router or simple state machine)
- [ ] B11.3 — Navigation: Upload → Mapping → Preview flow
- [ ] B11.4 — Import history list page (read-only, shows past uploads + status)
- [ ] B11.5 — API client utility (fetch wrapper with error handling)

---

## Milestone B Exit Criteria

- [ ] A nontechnical tester can upload a CSV or XLSX, review mappings, see issues and preview, and confirm an import plan — without developer assistance
- [ ] Server starts, connects to DB, serves API and embedded UI
- [ ] `npm run build` succeeds
- [ ] `npm test` passes (existing engine tests + new API tests)
