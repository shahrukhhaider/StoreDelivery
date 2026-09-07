# Inline Edit UX — Task Breakdown

## Phase 1: Foundation (Data Model + API)

### P1.1 — Database: catalog_overrides table
- Add Prisma model `CatalogOverride` with fields: `id`, `catalogId`, `productId`, `field`, `oldValue`, `newValue`, `source` (user | bulk_rule | auto_fix), `createdAt`
- Add migration
- Relation: `CatalogOverride` → `Catalog`, `CatalogOverride` → `CatalogProduct`

### P1.2 — Engine: override merger
- Create `src/engine/overrides/merge.ts`
- Function: `applyOverrides(product, overrides[])` → resolved product
- Merges draft edits onto the source `normalized_json` without mutating the original
- Handles nested fields (e.g. `variants[0].price`)
- Unit tests: single override, multiple overrides, undo (remove override), no-op for empty

### P1.3 — Engine: auto-fix detector
- Create `src/engine/overrides/auto-fix.ts`
- Scan products for safe deterministic fixes:
  - whitespace normalization
  - currency symbol cleanup ($24.99 → 24.99)
  - blank row removal
  - boolean normalization (yes/no → true/false)
  - known value corrections (e.g. weight unit normalization)
- Returns `CatalogOverride[]` with `source: "auto_fix"`
- Does NOT auto-fix: ambiguous identity, destructive changes, uncertain grouping
- Unit tests per fix type

### P1.4 — API: enhanced issues endpoint
- `GET /catalogs/:id/issues` — add query params:
  - `type` filter (missing_value, duplicate, invalid_value, etc.)
  - `severity` filter (blocking, warning, info)
  - `status` filter (open, resolved, ignored)
  - `page` / `pageSize` cursor pagination
- Return `affectedCount` per issue
- Return `suggestedFix` when available

### P1.5 — API: single product edit
- `PATCH /catalogs/:id/products/:productId` — accept field edits
- Store as `CatalogOverride` records (don't mutate `normalized_json`)
- Re-validate the product after applying override
- Return updated product with before/after diff

### P1.6 — API: bulk edit
- `POST /catalogs/:id/bulk-edit` — accept:
  - `action`: set_value | replace_value | clear_value
  - `field`: which field to edit
  - `value`: new value
  - `filter`: which products to affect (issue type, source key list, etc.)
- Create one `CatalogOverride` per affected product
- Return count of affected + count that would become invalid

### P1.7 — API: auto-fix
- `POST /catalogs/:id/auto-fix` — run auto-fix detector
- Store fixes as overrides with `source: "auto_fix"`
- Return summary: count fixed, count skipped, fix breakdown by type

### P1.8 — API: issue resolve / ignore
- `POST /catalogs/:id/issues/:issueId/resolve` — mark issue resolved
- `POST /catalogs/:id/issues/:issueId/ignore` — mark issue ignored
- Update issue status in DB

### P1.9 — API: preview with overrides
- `GET /catalogs/:id/preview` — return resolved catalog (source + overrides merged)
- Products endpoint also supports `?resolved=true` to return merged data
- Used by the import step — import reads resolved data, not raw source

### P1.10 — API: undo
- `DELETE /catalogs/:id/overrides/:overrideId` — remove a single edit
- `DELETE /catalogs/:id/overrides` — clear all draft edits (reset to source)
- Re-validate affected products after undo

---

## Phase 2: Core UI

### P2.1 — Issue summary banner with filter tabs
- Replace current simple banner with spec's filter tabs:
  All | Needs Review | Blocking | Warnings | Auto-fixed | Duplicate SKU | Missing Field | etc.
- Click a filter → filter the product grid
- Show counts per filter

### P2.2 — Enhanced product grid
- Server-side pagination with cursor (not offset — needed for 100k rows)
- Pass `issueType` / `severity` filter to API
- Issue highlighting: row border color by worst issue severity
- Status column shows resolved/open/ignored

### P2.3 — Inline cell editing
- Click a cell → turns into input field
- On blur/enter → `PATCH /catalogs/:id/products/:id`
- Show before/after indicator (original value in tooltip or strikethrough)
- Field-level validation on edit (show error inline if invalid)

### P2.4 — Auto-fix review
- "Run auto-fix" button or automatic on catalog load
- Collapsed summary: "231 issues fixed automatically [Review fixes]"
- Expand → show list of auto-fixes with before/after
- "Undo all auto-fixes" button

### P2.5 — Undo support
- "Undo" button on modified cells (reverts to source value)
- "Reset all edits" in page header
- Modified cell count indicator

---

## Phase 3: Guided Resolution

### P3.1 — Issue side panel
- Click an issue row → opens side panel with:
  - Issue description
  - Affected product count
  - Detected related fields (e.g. "Wholesale: 14.00, MSRP: 29.99")
  - Suggested fix with [Accept] / [Edit] / [Skip]
- LLM suggestion for complex issues (advisory only)

### P3.2 — Bulk resolution flow
- After resolving one issue, detect similar unresolved issues
- "86 similar rows have the same issue. [Apply to 86 rows]"
- Uses deterministic similarity: same column, same issue type, same pattern
- Preview: "✓ 84 valid, ⚠ 3 would become invalid"

### P3.3 — Bulk edit modal
- Modal for bulk operations:
  - Set value (e.g. set Vendor = "Acme" for 87 products)
  - Replace value (e.g. replace "N/A" with "" in Price)
  - Normalize value (e.g. fix all European prices)
  - Clear value
- Preview affected count + validation result before applying

---

## Phase 4: Performance

### P4.1 — Cursor-based pagination
- Replace offset pagination with cursor pagination in products API
- Support sort + filter with cursor
- Target: <500ms for filtered queries on 100k row catalogs

### P4.2 — Virtualized grid
- Replace Polaris IndexTable with virtualized rendering (react-window or similar)
- Only render visible rows
- Lazy load row data on scroll

### P4.3 — Async bulk edits
- Bulk edits > 1,000 rows run as background jobs
- Return operation ID, poll for completion
- Progress indicator in UI

### P4.4 — Database indexes
- Add indexes for common query patterns:
  - `catalog_overrides(catalog_id, product_id)`
  - `catalog_products(catalog_id, status)`
  - Issues query optimization

---

## Definition of Done (matches spec)

- [ ] Filter catalog by issue type
- [ ] Edit individual values inline
- [ ] Resolve issues from guided side panel
- [ ] Apply one fix to many similar rows
- [ ] Run all safe deterministic fixes
- [ ] See before/after values
- [ ] Undo draft edits before import
- [ ] Preview the resolved Shopify catalog
- [ ] Import without returning to Excel
