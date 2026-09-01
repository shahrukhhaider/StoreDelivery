# Shopify Supplier Catalog Importer — V0 Technical Spec

## Goal

Ship a **publishable Shopify App Store plugin** that converts supplier CSV/XLSX files into **new Shopify product listings** through a safe, review-first workflow.

V0 must be production-quality and extensible, but intentionally excludes catalog synchronization and updates.

> **V0 promise:** Upload supplier spreadsheet → review interpretation → import new Shopify products safely.

---

## 1. Scope

### Supported

- Shopify public app
- Shopify OAuth/install flow
- CSV upload
- XLSX upload
- automatic header/schema inference
- human-reviewable field mapping
- product + variant grouping
- validation and issue reporting
- image URL import
- product preview
- duplicate detection
- create-new-product import
- batched Shopify writes
- retryable failures
- import history/results
- tenant isolation
- App Store billing integration if paid at launch

### Explicitly deferred

- updating existing Shopify products
- stock sync
- price refresh
- catalog diff
- scheduled feeds
- supplier APIs
- SFTP/FTP
- XML/PDF
- Google Sheets
- rollback
- team approvals
- multi-store agency controls
- AI-generated images/descriptions

The V0 data model must not block these extensions.

---

## 2. Core Flow

```text
Install App
   ↓
Upload CSV/XLSX
   ↓
Parse + infer schema
   ↓
Map supplier fields
   ↓
Normalize into canonical catalog
   ↓
Validate
   ↓
Preview products/variants/images
   ↓
Detect possible duplicates
   ↓
Review import plan
   ↓
Create new Shopify products
   ↓
Verify + show item-level results
```

---

## 3. Architecture

```text
Shopify Embedded UI
        ↓
Application API
        ↓
Catalog Ingestion Service
        ↓
Parser
        ↓
Mapping Engine
        ↓
Canonical Catalog
        ↓
Validation Engine
        ↓
Import Planner
        ↓
Shopify Writer
        ↓
Operation Store
```

### Extension seam

Future versions attach here:

```text
Canonical Catalog
      ↓
Catalog Diff Engine
      ↓
ChangeSet
      ↓
Review / Approval
      ↓
Shopify Writer
```

The parser and canonical model must remain independent of Shopify API objects.

---

## 4. Recommended Stack

### App

- TypeScript
- React
- Shopify Polaris
- Shopify App Bridge
- current Shopify-recommended Node/React app framework
- Shopify Admin GraphQL API

### Persistence

- PostgreSQL
- Prisma/Drizzle or equivalent

### File storage

- private S3-compatible storage
- signed upload/read URLs
- raw file retention: configurable, default 30 days

### Background work

V0:
- DB-backed job table
- one worker process

Do not introduce Kafka/SQS/Temporal unless required by real scale.

---

## 5. Canonical Data Model

```typescript
type Catalog = {
  id: string;
  shopId: string;
  uploadId: string;
  source: CatalogSource;
  products: CatalogProduct[];
  issues: CatalogIssue[];
};

type CatalogSource = {
  fileName: string;
  format: "csv" | "xlsx";
  sheet?: string;
  schemaFingerprint: string;
};

type CatalogProduct = {
  sourceKey: string;
  title: string;
  description?: string;
  vendor?: string;
  productType?: string;
  tags: string[];
  variants: CatalogVariant[];
  images: CatalogImage[];
  sourceData: Record<string, unknown>;
};

type CatalogVariant = {
  sourceKey: string;
  sku?: string;
  barcode?: string;
  options: Record<string, string>;
  price?: string;
  compareAtPrice?: string;
  cost?: string;
  inventoryQuantity?: number;
  weight?: number;
  weightUnit?: string;
  sourceData: Record<string, unknown>;
};

type CatalogImage = {
  sourceUrl: string;
  variantSourceKey?: string;
  position?: number;
  altText?: string;
};
```

Preserve `sourceData` for debugging and later diff/reconciliation support.

---

## 6. Database Tables

Minimum V0:

### `shops`

- id
- shop_domain
- encrypted_access_token
- scopes
- installed_at
- uninstalled_at

### `catalog_uploads`

- id
- shop_id
- file_name
- storage_key
- format
- status
- created_at

### `catalogs`

- id
- shop_id
- upload_id
- schema_fingerprint
- parse_version
- created_at

### `field_mappings`

- id
- catalog_id
- source_column
- target_field
- confidence
- mapping_source: `rule | model | user`
- ignored

### `catalog_products`

- id
- catalog_id
- source_key
- normalized_json
- status

### `import_operations`

- id
- shop_id
- catalog_id
- status
- idempotency_key
- planned_count
- success_count
- failed_count
- skipped_count
- created_at
- completed_at

### `import_items`

- id
- import_operation_id
- source_product_key
- action
- status
- shopify_product_id
- error_code
- error_message

Tables should use shop-scoped queries and constraints.

---

## 7. File Parsing

### CSV

Support:

- UTF-8 / UTF-8 BOM
- comma
- tab
- semicolon
- quoted fields
- embedded newline handling
- delimiter detection
- whitespace normalization

Reject:

- unreadable binary data
- files above configured size limit
- empty files

### XLSX

Support:

- workbook parsing
- sheet listing
- one selected data sheet
- displayed cell values

If multiple candidate sheets contain tabular data, require user selection.

---

## 8. Schema / Header Mapping

Mapping pipeline:

### 8.1 Deterministic aliases

Example:

```text
item no
item number
part number
sku #
stock code
```

→ `variant.sku`

Maintain versioned alias dictionaries.

### 8.2 Type inference

Infer likely field classes from sample values:

- currency
- integer
- URL
- barcode
- boolean
- text/category

### 8.3 LLM inference

Only for unresolved/ambiguous columns.

Send:

```json
{
  "header": "Retail",
  "neighbor_headers": ["Wholesale", "MAP"],
  "sample_values": ["24.99", "39.99", "12.50"],
  "allowed_targets": ["price", "compare_at_price", "cost", "ignore"]
}
```

Model must choose from an enum.

Never accept arbitrary schema output.

### Confidence policy

- high: preselected
- medium: preselected + marked Review
- low: unmapped, merchant must choose

---

## 9. Product / Variant Grouping

Preferred grouping keys:

1. explicit parent/style/product ID
2. known variant grouping column
3. deterministic SKU pattern
4. shared title + option columns
5. semantic suggestion only when necessary

Never silently group rows based only on LLM output.

Ambiguous groups require preview/confirmation.

---

## 10. Validation

### Blocking

- missing product title
- invalid variant structure
- malformed price where price is mapped
- no viable row/product structure

### Warning

- missing SKU
- duplicate SKU
- duplicate barcode
- unreachable image URL
- ambiguous mapping
- suspiciously large/small price
- empty option value

### Info

- blank row removed
- whitespace cleaned
- value normalized

User-facing summary:

```text
428 products detected

Automatically fixed: 231 issues
Needs review: 17
Blocking: 2
```

---

## 11. Duplicate Detection

Before writes, read Shopify identifiers needed for duplicate checks.

Check:

- SKU
- barcode
- optional handle/title heuristic

V0 behavior:

- show possible duplicate
- default action = skip
- merchant may exclude from import
- never update existing product

---

## 12. Preview

Preview must show:

- product title
- vendor
- type
- variants
- SKU
- price
- image count
- warnings

Summary:

```text
Ready: 412
Needs review: 14
Blocked: 2
Possible duplicates: 8
```

Import button disabled while blocking issues remain in selected products.

---

## 13. Import Plan

Before any write:

```text
This import will:

Create 412 products
Create 1,188 variants
Attach 840 images

Skip 8 possible duplicates

Existing products will not be modified.
```

Persist the immutable plan before execution.

---

## 14. Shopify Writer

Use Shopify Admin GraphQL API.

Requirements:

- bounded batch/concurrency
- rate-limit feedback
- retry transient errors
- no retry for permanent validation failures
- item-level persistence
- idempotent operation key
- resumable partially completed operation
- capture Shopify product IDs

The worker must be restart-safe.

---

## 15. Idempotency

Prevent duplicate imports from:

- page refresh
- repeated button clicks
- API retry
- worker retry
- network timeout

`import_operation.idempotency_key` should derive from:

```text
shop_id + catalog_id + import_plan_hash
```

Each item must record successful completion before retrying the operation.

---

## 16. Image Handling

V0 supports remote image URLs only.

Flow:

```text
supplier image URL
    ↓
validate URL syntax
    ↓
optional HEAD/GET check
    ↓
attach through Shopify-supported media flow
    ↓
record failures independently
```

Image failure should not necessarily fail product creation.

Report:

```text
Product created
2/3 images attached
1 image failed
```

---

## 17. Operation Results

After completion:

```text
Import complete

408 products created
4 failed
8 skipped

[View failures]
[Retry failures]
```

Retry only failed items.

Exportable error report is optional but useful for App Store-quality UX.

---

## 18. Shopify App Requirements

Before submission, verify current Shopify requirements.

Implementation must include:

- OAuth installation
- minimum required scopes
- embedded app UX
- Shopify session validation
- app uninstall handling
- privacy policy
- terms/support URLs
- Shopify billing if charging through the app
- production callback URLs
- stable onboarding
- no broken/placeholder screens
- review instructions
- demo/test data if needed for review
- required compliance webhooks/data handling

Do not request inventory/order/customer scopes in V0 unless strictly required.

---

## 19. Security

- encrypt Shopify tokens at rest
- strict tenant isolation
- private file storage
- signed short-lived file URLs
- never log supplier file contents wholesale
- redact access tokens/secrets
- CSRF/session protections
- validate all file types and sizes
- escape spreadsheet/formula-like values when exporting
- verify all Shopify webhooks
- delete merchant data on required lifecycle events

---

## 20. LLM Guardrails

LLM is advisory only.

Allowed:

- field mapping suggestions
- category interpretation
- grouping suggestions
- human-readable issue explanations

Not allowed:

- direct Shopify mutations
- arbitrary GraphQL generation/execution
- silently creating transformations
- deciding destructive actions

Every LLM result passes:

```text
strict schema
→ deterministic validation
→ merchant review when ambiguous
```

---

## 21. Observability

Track:

- upload success/failure
- parser failures
- schema inference duration
- mapping confidence distribution
- manual remap rate
- catalog validation errors
- duplicate count
- Shopify mutation failure rate
- rate-limit events
- import completion rate
- time to first successful import
- average products/import

Error logging must include operation IDs but avoid raw sensitive catalog data.

---

## 22. Testing

### Unit

- parsers
- delimiter/encoding detection
- aliases
- number/currency normalization
- variant grouping
- validation
- plan generation

### Golden fixtures

Maintain real/synthetic files:

```text
simple.csv
variants_rows.csv
duplicate_skus.csv
european_prices.csv
image_columns.xlsx
bad_headers.csv
parent_child.xlsx
weird_encoding.csv
```

Each maps to canonical expected JSON.

### Shopify integration

Development store tests:

- 1 product
- 100 products
- 1,000+ products
- image failure
- duplicate request
- rate limiting
- transient API failure
- partial failure
- worker restart

### Security

- cross-shop access tests
- malformed upload
- oversized upload
- token leakage checks
- webhook spoofing
- duplicate operation submission

---

## 23. Publishability Checklist

V0 is App Store submission-ready when:

- install/uninstall works
- no placeholder UI
- all requested scopes are justified
- file upload errors are understandable
- merchant can complete import without developer help
- import is safe against duplicate execution
- partial failures are recoverable
- privacy policy/support/terms exist
- billing flow works if enabled
- support contact is visible
- app has polished listing copy/screenshots
- review instructions are reproducible
- all mandatory Shopify compliance requirements pass

---

## 24. Extension Compatibility

V0 must preserve these extension points.

### V1 — Supplier profiles

Add:

```text
supplier_profiles
transformation_rules
saved_mappings
```

No parser rewrite.

### V2 — Catalog reconciliation

Add:

```text
shopify_snapshot
catalog_snapshot
diff_engine
change_set
change_items
change_policies
```

Reuse canonical catalog and Shopify writer.

### V3 — Rollback / sync

Add:

```text
operation_snapshots
feed_connections
scheduled_jobs
rollback_operations
audit_events
```

Existing `import_operations` should evolve into generic `catalog_operations`.

---

## 25. Build Order

### Milestone A — Offline engine

Deliver:
- CSV/XLSX parser
- canonical model
- mapping
- validation
- fixtures

Exit:
- 10+ different catalog schemas normalized correctly

### Milestone B — Merchant preview

Deliver:
- upload
- mapping review
- issues
- preview
- import plan

Exit:
- nontechnical tester can complete without assistance

### Milestone C — Shopify write path

Deliver:
- install/auth
- duplicate detection
- product creation
- image attach
- batching
- retries
- results

Exit:
- safe 1,000+ product import in dev store

### Milestone D — Publication hardening

Deliver:
- billing if required
- privacy/support
- lifecycle cleanup
- observability
- polished onboarding
- App Store assets

Exit:
- Shopify review submission

---

## 26. V0 Definition of Done

A merchant can:

1. Install the public Shopify app.
2. Upload CSV/XLSX.
3. Receive automatic supplier-field mappings.
4. Correct ambiguous mappings.
5. Understand catalog issues.
6. Preview products/variants/images.
7. See possible duplicates.
8. Confirm an immutable import plan.
9. Safely create new products.
10. View item-level results.
11. Retry only failures.
12. Uninstall cleanly.

And the internal architecture can later support:

```text
saved supplier
→ catalog diff
→ review
→ update
→ sync
→ rollback
```

without replacing the ingestion/canonical/import foundations.
