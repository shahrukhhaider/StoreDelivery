# Milestone C — Shopify Write Path

**Goal:** Install/auth, duplicate detection, product creation, image attach, batched writes, retries, results.
**Exit criteria:** Safe 1,000+ product import in a Shopify dev store.

---

## Task C1: Shopify GraphQL Client

**File:** `src/server/shopify/graphql-client.ts`

- [ ] C1.1 — Thin GraphQL client wrapping fetch with auth header + rate-limit handling
- [ ] C1.2 — Automatic retry on 429 / 5xx with exponential backoff
- [ ] C1.3 — Cost-based throttling using Shopify's `extensions.cost` response
- [ ] C1.4 — Request logging (operation name, cost, duration)

---

## Task C2: Shopify OAuth & Session

**File:** `src/server/shopify/auth.ts`
**Spec:** Section 18

- [ ] C2.1 — Install redirect: `GET /auth` → Shopify OAuth consent screen
- [ ] C2.2 — OAuth callback: `GET /auth/callback` → exchange code for access token
- [ ] C2.3 — Encrypt + store token in `shops` table
- [ ] C2.4 — Session validation middleware (verify HMAC / session token)
- [ ] C2.5 — Uninstall webhook handler (`POST /webhooks/uninstall`)
- [ ] C2.6 — Dev-mode bypass: skip auth when `SHOPIFY_API_KEY` is empty

---

## Task C3: Duplicate Detector

**File:** `src/server/shopify/duplicate-detector.ts`
**Spec:** Section 11

- [ ] C3.1 — Fetch existing product SKUs from Shopify via GraphQL (paginated)
- [ ] C3.2 — Fetch existing barcodes
- [ ] C3.3 — Compare catalog products against existing identifiers
- [ ] C3.4 — Return duplicate matches with match type (sku / barcode / title)
- [ ] C3.5 — Mark duplicates in import items as `skip`

---

## Task C4: Shopify Product Writer

**File:** `src/server/shopify/writer.ts`
**Spec:** Section 14

- [ ] C4.1 — `productCreate` GraphQL mutation builder from CatalogProduct
- [ ] C4.2 — Bounded concurrency (configurable, default 4 concurrent)
- [ ] C4.3 — Rate-limit feedback: pause + backoff on throttle
- [ ] C4.4 — Retry transient errors (network, 5xx), no retry for validation errors
- [ ] C4.5 — Per-item status persistence: update import_item on each success/failure
- [ ] C4.6 — Capture Shopify product IDs on success

---

## Task C5: Image Attachment

**File:** `src/server/shopify/image-handler.ts`
**Spec:** Section 16

- [ ] C5.1 — Attach images via `productCreateMedia` or inline in productCreate
- [ ] C5.2 — Image failure does not block product creation
- [ ] C5.3 — Per-image success/failure tracking
- [ ] C5.4 — Report: "2/3 images attached, 1 failed"

---

## Task C6: Import Executor

**File:** `src/server/jobs/import-executor.ts`
**Spec:** Sections 13-15

- [ ] C6.1 — Load planned import operation + catalog products
- [ ] C6.2 — Run duplicate detection before writes
- [ ] C6.3 — Create import_items records (pending) for each product
- [ ] C6.4 — Execute writes via Shopify writer in batches
- [ ] C6.5 — Update operation counters (success/failed/skipped) in real-time
- [ ] C6.6 — Mark operation complete/failed when done
- [ ] C6.7 — Resumable: skip already-succeeded items on restart

---

## Task C7: Import API Endpoints

**File:** `src/server/api/import.ts`

- [ ] C7.1 — `POST /api/imports/:operationId/execute` — kick off import
- [ ] C7.2 — `GET /api/imports/:operationId` — status + progress
- [ ] C7.3 — `GET /api/imports/:operationId/items` — paginated item results
- [ ] C7.4 — `POST /api/imports/:operationId/retry` — retry failed items only

---

## Task C8: Results UI

**Files:** `src/web/pages/ResultsPage.tsx`
**Spec:** Section 17

- [ ] C8.1 — Progress view during import (polling)
- [ ] C8.2 — Completion summary: created / failed / skipped
- [ ] C8.3 — Item-level results table with error details
- [ ] C8.4 — Retry failed items button
- [ ] C8.5 — Wire navigation: preview → execute → results

---

## Task C9: Update App Shell

- [ ] C9.1 — Auth-aware routing: redirect to install if no session
- [ ] C9.2 — Replace dev X-Shop-Id with real session token in API client
- [ ] C9.3 — History page: list past import operations with status

---

## Milestone C Exit Criteria

- [ ] OAuth install/uninstall works against a dev store
- [ ] Duplicate detection correctly identifies existing SKUs
- [ ] 1,000+ product import completes safely in dev store
- [ ] Partial failures are resumable
- [ ] Image failures don't block product creation
- [ ] `npm run build` succeeds
- [ ] `npm test` passes
