# Rollback Feature — Task Breakdown

## Phase 1: Database + Engine

### R1.1 — Database schema
- Add `RollbackOperation` model: id, importOperationId, shopId, status, planned/success/failed/skipped counts, timestamps
- Add `RollbackItem` model: id, rollbackOperationId, sourceProductKey, shopifyProductId, status, errorMessage
- Relations: RollbackOperation → ImportOperation, Shop; RollbackItem → RollbackOperation
- Add migration
- Indexes: rollbackOperationId on items, shopId on operations

### R1.2 — Shopify product deleter
- New file: `src/server/shopify/deleter.ts`
- `productDelete` GraphQL mutation
- Bounded concurrency (same pattern as writer)
- Rate-limit handling via existing GraphQL client
- Retry transient errors
- Handle "Product not found" as skipped (not failed)
- Per-item callback for progress tracking
- Unit tests: mock responses for success, not-found, error

### R1.3 — Rollback executor
- New file: `src/server/jobs/rollback-executor.ts`
- Load import operation + import items with Shopify product IDs
- Create rollback items (pending)
- Execute deletions via deleter
- Update rollback operation counts in real-time
- Mark completed/failed when done
- Resumable: skip already-succeeded items on restart
- Retry-failed-only function
- Unit tests for execution logic

## Phase 2: API

### R2.1 — Create rollback endpoint
- `POST /api/rollbacks` — accept importOperationId + optional productIds filter
- Validate: import must be "completed", products must have shopify_product_id
- Create rollback_operation + rollback_items
- Return preview: count, product list with titles/SKUs

### R2.2 — Rollback status + items endpoints
- `GET /api/rollbacks/:id` — status, progress %, counts
- `GET /api/rollbacks/:id/items` — paginated items with status filter

### R2.3 — Execute + retry endpoints
- `POST /api/rollbacks/:id/execute` — start async rollback
- `POST /api/rollbacks/:id/retry` — retry failed items

### R2.4 — API client methods
- Add typed client methods for all rollback endpoints

## Phase 3: UI

### R3.1 — Rollback button on Import History + Results pages
- Show "Rollback" button (destructive tone) on completed imports
- Only visible when import has successfully created products

### R3.2 — Rollback Preview page
- Original import details (file name, date, product count)
- Product list with checkboxes (title, SKU, Shopify ID)
- Select all / deselect
- "Delete All" / "Delete Selected" buttons
- Warning banner about irreversibility

### R3.3 — Confirmation modal
- "Are you sure? This will permanently delete N products..."
- Cancel / Confirm buttons
- On confirm → create rollback + execute

### R3.4 — Rollback Progress + Results page
- Progress bar during execution
- Completion summary: deleted / failed / skipped
- Item-level results table
- Retry failed button
- Back to history

### R3.5 — Wire into app navigation
- Add rollback route to App.tsx
- History page → Rollback preview → Progress → Results

## Phase 4: Tests

### R4.1 — Rollback executor tests
- Successful deletion of all products
- Partial failure (some delete, some fail)
- Already-deleted products → skipped
- Resume after interruption
- Retry-only-failed

### R4.2 — Rollback API tests
- Create rollback: valid import, invalid import, selective products
- Execute: status transitions, progress tracking
- Items: pagination, status filter

### R4.3 — Deleter unit tests
- productDelete mutation format
- Success response parsing
- Not-found handling → skipped
- Error response handling

---

## Definition of Done

- [ ] Merchant can rollback a completed import from the history page
- [ ] Preview shows exactly which products will be deleted
- [ ] Selective rollback: choose specific products to delete
- [ ] Confirmation modal warns about irreversibility
- [ ] Real-time progress during deletion
- [ ] Item-level results with retry for failures
- [ ] Rollback operation recorded permanently for audit
- [ ] Already-deleted products handled gracefully (skipped)
- [ ] All tests pass
