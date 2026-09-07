# StoreDelivery Rollback — Technical Spec

## Goal

Allow merchants to **undo a completed import** — delete all products that were created by a specific import operation, restoring the store to its pre-import state.

This is a safety net. Merchants who import 500 products from a supplier file and realize something is wrong (wrong prices, wrong vendor, duplicate batch) can press one button and cleanly remove everything that import added.

---

## Scope

### V1 Rollback (this spec)

- Delete products created by a specific import operation
- Selective rollback: choose which products to delete or delete all
- Preview before execution (show what will be deleted)
- Per-item tracking (success/failed/skipped)
- Resumable if interrupted
- Audit trail: snapshot + rollback operation recorded permanently

### Not in scope

- Undoing product updates (V2 feature — we only create products in V0)
- Restoring deleted products (Shopify doesn't support undelete)
- Rolling back across multiple import operations at once
- Automatic scheduled rollback
- Partial field rollback (undo just the price change on 50 products)

---

## Prerequisites

Already built:

- `import_operations` table — tracks every import with status, counts
- `import_items` table — per-product result with `shopify_product_id`
- `import_snapshots` table — permanent record of applied overrides at import time
- `ShopifyGraphQLClient` — rate-limit aware with retry

---

## Data Model

### Existing (no changes needed)

```
import_operations
  → id, status, shop_id, catalog_id, success_count, ...

import_items
  → id, import_operation_id, source_product_key, shopify_product_id, status

import_snapshots
  → id, import_operation_id, applied_overrides (JSON), resolved_product_count
```

### New table: `rollback_operations`

```
id                    String    @id @default(cuid())
import_operation_id   String    (links to original import)
shop_id               String
status                "planned" | "in_progress" | "completed" | "failed" | "cancelled"
planned_count         Int       (products to delete)
success_count         Int       (successfully deleted)
failed_count          Int       (failed to delete)
skipped_count         Int       (already deleted or not found)
created_at            DateTime
completed_at          DateTime?
```

### New table: `rollback_items`

```
id                    String    @id @default(cuid())
rollback_operation_id String
source_product_key    String
shopify_product_id    String
status                "pending" | "success" | "failed" | "skipped"
error_message         String?
```

---

## User Flow

```text
Import History page
  ↓
Click "Rollback" on a completed import
  ↓
Rollback Preview:
  "This will delete 284 products created on Sep 6, 2026"
  [product list with checkboxes]
  [Delete All] or [Delete Selected]
  ↓
Confirmation modal:
  "Are you sure? This will permanently delete 284 products
   from your Shopify store. This cannot be undone."
  [Cancel] [Confirm Rollback]
  ↓
Rollback executes (shows progress)
  ↓
Results:
  "280 deleted, 2 failed, 2 already removed"
  [Retry failed]
```

---

## Shopify API

Use `productDelete` mutation:

```graphql
mutation ProductDelete($input: ProductDeleteInput!) {
  productDelete(input: $input) {
    deletedProductId
    userErrors {
      field
      message
    }
  }
}
```

Input: `{ id: "gid://shopify/Product/123" }`

Requirements:
- Same bounded concurrency as the writer (default 4)
- Same rate-limit handling
- Retry transient errors
- Skip products that are already deleted (404 → skipped, not failed)
- Per-item status tracking

---

## API Endpoints

```text
POST   /api/rollbacks
         body: { importOperationId, productIds? (optional — omit for all) }
         → creates rollback_operation + rollback_items
         → returns rollback preview (count, product list)

GET    /api/rollbacks/:id
         → status, progress, counts

POST   /api/rollbacks/:id/execute
         → starts async rollback execution

GET    /api/rollbacks/:id/items
         → paginated list of rollback items with status

POST   /api/rollbacks/:id/retry
         → retry failed items only
```

---

## Execution Logic

```text
1. Load import operation (must be "completed")
2. Load import_items where status = "success" and shopify_product_id is not null
3. Optionally filter to selected product IDs
4. Create rollback_operation + rollback_items (all "pending")
5. For each item:
   a. Call productDelete with shopify_product_id
   b. If success → mark "success"
   c. If "Product not found" → mark "skipped"
   d. If transient error → retry
   e. If permanent error → mark "failed"
6. Update rollback_operation counts
7. Mark "completed" or "failed" when done
```

---

## Safety

- Rollback only works on imports with status "completed"
- Rollback only deletes products that have a `shopify_product_id` (actually created)
- Double-delete is safe: Shopify returns an error for already-deleted products → "skipped"
- Confirmation modal with product count and explicit "this cannot be undone"
- Rollback operation is logged permanently for audit
- Cannot rollback a rollback (one-way)

---

## UI Pages

### Rollback button on Import History / Results

On completed imports, show a "Rollback" button (destructive tone).

### Rollback Preview Page

Shows:
- Original import details (file name, date, product count)
- List of products that will be deleted (title, SKU, Shopify ID)
- Select/deselect individual products
- "Delete All" and "Delete Selected" buttons
- Warning banner about irreversibility

### Rollback Progress / Results

Same pattern as import results:
- Progress bar during execution
- Completion summary: deleted / failed / skipped
- Item-level results table
- Retry failed button

---

## Performance

- Same bounded concurrency as import writer (4 concurrent)
- Rate-limit handling via existing GraphQL client
- Async execution: returns immediately, polls for progress
- For >1000 products: chunked execution with progress updates

---

## Rollback Definition of Done

Merchant can:

1. View a completed import in history
2. Click "Rollback" and see what will be deleted
3. Optionally deselect specific products
4. Confirm the rollback with a clear warning
5. See real-time progress during deletion
6. View item-level results (deleted / failed / skipped)
7. Retry failed deletions
8. The rollback operation is recorded permanently for audit
