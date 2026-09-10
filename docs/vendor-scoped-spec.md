# Vendor-Scoped Catalog & Inventory Updates — Spec

## Overview

Three-phase implementation to support per-vendor catalog management:

- **Phase 1 — Vendor Identity Foundation**: Vendor profiles, detection, selection UI, and column mapping persistence per vendor.
- **Phase 2 — Upload Modes**: Two distinct upload semantics — Catalog Update (full snapshot) and Inventory Update (partial fields).
- **Phase 3 — Shopify Vendor Scoping**: App-owned metafield on Shopify products, vendor-scoped reconciliation, and MISSING classification.

Each phase is independently shippable.

---

## Phase 1 — Vendor Identity Foundation

### Goal

> Select the supplier once, teach StoreDelivery its schema once.

When a merchant uploads a file, StoreDelivery should:
1. Detect who the supplier is (from column data or prior uploads)
2. Confirm if confidence is insufficient
3. Load the supplier's previously saved column mappings
4. Save mappings back after a successful import

### 1.1 VendorProfile model

Rename/extend `SupplierProfile` to carry merchant-visible identity.

```
VendorProfile
  id               String  (cuid)
  shopId           String
  name             String              ← merchant-settable display name
  normalizedName   String              ← URL-safe slug, e.g. "acme-distribution"
  schemaFingerprint String?            ← nullable; used for auto-detect (existing field)
  createdAt        DateTime
  updatedAt        DateTime
```

**Uniqueness:** `@@unique([shopId, normalizedName])` — two vendors in the same shop cannot share a slug.

**`normalizedName` generation:** lowercase, replace non-alphanumeric with hyphens, collapse hyphens, trim. Example: `"Acme Distribution Ltd."` → `"acme-distribution-ltd"`.

**Backward compatibility:** existing `SupplierProfile` records remain; a migration adds `normalizedName` (default generated from existing `name`) and the new unique constraint.

---

### 1.2 VendorColumnMapping model

Per-vendor saved column mappings, replacing the per-catalog `FieldMapping` as the durable store.

```
VendorColumnMapping
  id              String  (cuid)
  vendorId        String              ← FK → VendorProfile.id
  sourceColumn    String              ← raw column header from source file
  canonicalField  String?             ← mapped target field (null = ignored)
  ignored         Boolean  default false
  transformConfig Json?               ← reserved for future transforms
  createdAt       DateTime
  updatedAt       DateTime
```

**Uniqueness:** `@@unique([vendorId, sourceColumn])` — one mapping per column per vendor.

**Persistence rule:** saved or overwritten only after a successful Catalog Update (see Phase 2). Inventory Updates may load from this table but never overwrite it.

---

### 1.3 Vendor detection

After column mapping is applied and products are normalized, scan the product list to detect the vendor.

**Detection sources (in priority order):**

1. **Mapped vendor column** — if `product.vendor` field is populated across most products and matches an existing `VendorProfile.name` (case-insensitive, normalized) → HIGH confidence.
2. **Schema fingerprint match** — if the current file's schema fingerprint matches a `VendorProfile.schemaFingerprint` → HIGH confidence.
3. **Partial name match** — if `product.vendor` value is similar to an existing vendor name (normalized prefix/substring match) → MEDIUM confidence.
4. **No match** → NONE, merchant must select/create.

**Detection result:**

```ts
type VendorDetectionResult = {
  confidence: "HIGH" | "MEDIUM" | "NONE";
  matchedVendorId: string | null;
  matchedVendorName: string | null;
  candidateVendorName: string | null;  // extracted from file, not yet matched
};
```

A HIGH confidence match auto-resolves the vendor and can skip the confirmation prompt. MEDIUM and NONE always show the selection prompt.

---

### 1.4 Vendor selection UI

A new step inserted between upload and column mapping.

**Route:** `vendor-confirm` — positioned after upload, before mapping.

**When shown:**
- Always on first upload (no prior mapping for this schema)
- Always when confidence is MEDIUM or NONE
- Optionally skippable when confidence is HIGH (auto-resolve) — but should still show a "Using vendor: Acme Distribution" confirmation pill in the mapping header

**UI:**

```
Who is this catalog from?

Detected: "Acme Distribution"

○ Use existing vendor: Acme Distribution  ← pre-selected if HIGH confidence
○ Use existing vendor: [ dropdown ]
○ Create new vendor:   [ __________________ ]

[ Continue ]
```

**API endpoints required:**
- `GET /api/shops/:shopId/vendors` — list all VendorProfiles for the shop
- `POST /api/catalogs/:id/vendor` — set vendorId on the catalog
- `GET /api/catalogs/:id/vendor` — get current vendor assignment

**Catalog model addition:** `vendorId String? @map("vendor_id")` FK to `VendorProfile`.

---

### 1.5 Column mapping pre-load from vendor history

When the mapping page loads for a catalog that has a resolved vendor, load `VendorColumnMapping` records and apply them as pre-populated suggestions.

**API behavior:** `GET /api/catalogs/:id/mappings` response should include a `vendorMappings` flag per column indicating whether it came from a saved vendor mapping vs. fresh inference.

**Processing flow:**
```
Upload file
  ↓
Auto-detect vendor
  ↓
Load VendorColumnMapping for resolved vendor
  ↓
Pass as existingMappings to processCatalog()
  ↓
Mapping page shows pre-filled columns from vendor history
  ↓ (user confirms or adjusts)
PUT /api/catalogs/:id/mappings
```

---

### 1.6 Save mappings after successful Catalog Update

After an `ImportOperation` reaches `status: "completed"`:

1. Load the catalog's `FieldMapping` records (representing the confirmed mapping for this run).
2. Upsert each as a `VendorColumnMapping` for the catalog's resolved vendor.
3. Update `VendorProfile.schemaFingerprint` to the current file's schema fingerprint.

This ensures the next upload from the same vendor pre-loads the correct mapping.

**Location:** post-completion hook in `import-executor.ts`.

---

### Phase 1 — Invariants

1. Every catalog uploaded to the system belongs to at most one vendor (may be null if merchant skips).
2. A vendor's column mapping is only updated after a successful Catalog Update.
3. Vendor identity is merchant-confirmed, never silently assumed.
4. `normalizedName` is unique per shop — no two vendors share a slug.

---

## Phase 2 — Upload Modes

### Goal

Support two semantically distinct upload types:

| | Catalog Update | Inventory Update |
|---|---|---|
| Intent | Full supplier catalog | Partial field patch |
| Create products | Yes | Never |
| Detect MISSING | Yes (in Phase 3) | Never |
| Update fields | All diffed fields | Only columns present in file |
| Column save | Yes (on success) | No (reads but doesn't save) |

### 2.1 Upload mode selection

**Mode selector UI** shown on the upload page or as a pre-upload step:

```
What type of file are you uploading?

● Full Catalog    — create new products and update existing ones
○ Inventory Update — update quantities, prices, and other fields only
```

**Schema change:** `CatalogUpload` gains:
```
uploadMode  UploadModeEnum  @default(CATALOG_UPDATE)

enum UploadModeEnum {
  CATALOG_UPDATE
  INVENTORY_UPDATE
}
```

---

### 2.2 Catalog Update semantics

Existing behavior — no change required.

`NEW_PRODUCT → CREATE_PRODUCT`
`EXISTING → diff + update proposal`
`MISSING → surface (Phase 3)`

---

### 2.3 Inventory Update semantics

When `uploadMode === INVENTORY_UPDATE`:

**In reconciliation engine:**
- `NEW_PRODUCT` → forced to `SKIP` — no product creation, ever
- `MISSING` classification — not computed (partial file, absence means nothing)
- `EXISTING` → diff only the fields that have a mapped column in the current file

**In update writer:**
- Only write fields where the supplier explicitly provided a value (non-null, column mapped)
- Do not clear fields that are absent from the file
- Never call `productVariantsBulkCreate` for variants not in the file

**Field-level partial semantics rule:**

> If a column is not mapped → that field is excluded from the diff. The existing Shopify value is left untouched.

This is already partially enforced by the "guard" pattern (`if (supplier.cost != null) { compareField... }`). Inventory Update mode strengthens this to all fields.

---

### 2.4 Mapping save guard

In `import-executor.ts` post-completion hook:

```ts
if (catalog.uploadMode === "CATALOG_UPDATE") {
  await saveVendorColumnMappings(catalog.vendorId, fieldMappings);
}
// INVENTORY_UPDATE: mappings are loaded but not saved back
```

---

### Phase 2 — Invariants

5. An Inventory Update never creates a Shopify product.
6. An Inventory Update never shows MISSING classification.
7. Missing columns in an Inventory Update mean "leave unchanged" — never "clear."
8. Column mappings are only promoted to vendor-level after a successful Catalog Update.

---

## Phase 3 — Shopify Vendor Scoping

### Goal

Make the vendor relationship durable on Shopify products so StoreDelivery can:
- Fetch only a vendor's products (not the entire catalog)
- Detect which of the vendor's Shopify products are absent from the incoming file (`MISSING`)

---

### 3.1 App-owned metafield

Write on every product created during a Catalog Update:

```
namespace:  $app:store_delivery
key:        vendor_id
value:      <VendorProfile.id>
type:       single_line_text_field
```

**Mutation change in `writer.ts` `buildProductSetInput()`:**
```ts
metafields: [{
  namespace: "$app:store_delivery",
  key: "vendor_id",
  value: vendorProfileId,
  type: "single_line_text_field",
}]
```

**Registration:** app-owned metafield definitions in the `$app` namespace do not require explicit registration — they are auto-created by the first write.

**VendorProfile.id must be threaded through** the write pipeline. Currently `CatalogProduct` and `locationId` are passed; `vendorProfileId` must be added.

---

### 3.2 Optional vendor tag

Append `storedelivery:vendor:<normalizedName>` to the product's tags at create time.

**Purpose:** human-readable visibility in Shopify Admin; also usable as a fallback query when metafields are unavailable.

**Implementation:** in `buildProductSetInput()`, append to the product's `tags` array before writing.

---

### 3.3 Vendor-scoped Shopify query

Fetch all Shopify product IDs owned by a vendor using metafield search.

**GraphQL query:**
```graphql
query VendorProducts($vendorId: String!, $cursor: String) {
  products(
    first: 250,
    after: $cursor,
    query: "metafield:$app:store_delivery.vendor_id=<vendorId>"
  ) {
    edges {
      node {
        id
        title
        variants(first: 1) {
          edges { node { sku } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

**Result:** a `Set<shopifyProductId>` representing the full vendor scope on Shopify.

---

### 3.4 MISSING classification

After classifying the incoming products, compute the set-difference:

```
vendorShopifyProductIds (from 3.3)
  MINUS
matchedShopifyProductIds (products matched in the incoming file)
  =
missingProductIds (products in Shopify vendor scope but absent from file)
```

For each missing product, emit a `MISSING` classification record:

```ts
{
  sourceProductKey: `__missing__:${shopifyProductId}`,
  classification: "MISSING",
  proposedAction: "NO_ACTION",
  matchedShopifyProductId: shopifyProductId,
  confidence: "HIGH",
  matchEvidence: [{ type: "vendor_scope", ... }],
}
```

**V1 behavior:** show in UI as informational only. No automatic removal. No action button (Phase 3 leaves deletion to the merchant).

**Only computed in Catalog Update mode** — Inventory Update skips this entirely.

---

### 3.5 UI — MISSING tab / marker

On the Edit page, add a `missing` tab (or a count in the existing Warning tab) showing products from the vendor's Shopify catalog that were absent from the uploaded file.

Display:

```
5 products missing from this upload

gid://shopify/Product/123  "Classic Tee"        → View in Shopify
gid://shopify/Product/456  "Slim Fit Chino"     → View in Shopify
```

Each row links to the Shopify product. No apply action in V1.

---

### Phase 3 — Invariants

9. The app-owned metafield `$app:store_delivery.vendor_id` is the authoritative scope signal.
10. MISSING classification is only computed during Catalog Update.
11. MISSING products are surfaced informationally — no automatic deletion in V1.
12. Vendor scoping queries Shopify by app-owned metafield, not by tag (tags are advisory only).

---

## Implementation Order

```
Phase 1
  1a. DB: add normalizedName to SupplierProfile + migration
  1b. DB: add VendorColumnMapping model + migration
  1c. DB: add vendorId FK to Catalog model + migration
  1d. Server: vendor detection logic (pure function)
  1e. Server: GET/POST /api/vendors + POST /api/catalogs/:id/vendor
  1f. Server: GET /api/catalogs/:id/mappings — return vendor-sourced mappings
  1g. Server: load VendorColumnMapping in processCatalog() when vendor resolved
  1h. Server: save VendorColumnMapping on successful import
  1i. UI: vendor-confirm route + VendorConfirmPage
  1j. UI: vendor pill in MappingPage header

Phase 2
  2a. DB: uploadMode on CatalogUpload + migration
  2b. UI: mode selector on UploadPage
  2c. Engine: Inventory Update mode gate in reconciliation engine
  2d. Engine: partial-field semantics enforcement for Inventory Update
  2e. Server: mapping save guard — only on CATALOG_UPDATE success

Phase 3
  3a. Server: write vendor metafield in writer.ts
  3b. Server: write vendor tag in writer.ts
  3c. Server: vendor-scoped Shopify query
  3d. Engine: MISSING classification + set-difference logic
  3e. DB: add MISSING to ReconciliationClassification enum + migration
  3f. UI: MISSING display on Edit page
```
