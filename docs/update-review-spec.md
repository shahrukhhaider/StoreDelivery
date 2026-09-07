# StoreDelivery — Selective Update Review

## Goal

When a supplier catalog contains updated data for products that already exist in Shopify, the merchant should see exactly what changed and choose which updates to apply — per product, per field, or in bulk.

V1 skips all existing products. This spec adds the ability to review and selectively apply changes to mapped products.

---

## Current State

```text
EXISTING_MAPPED → proposedAction: NO_CHANGE → SKIP
```

All recognized products are silently skipped regardless of whether the supplier data differs from what's in Shopify.

## Target State

```text
EXISTING_MAPPED
  ↓
Compute diff: supplier data vs Shopify snapshot
  ↓
No changes  → NO_CHANGE → skip
Has changes → UPDATE_REVIEW → present diff to merchant
  ↓
Merchant selects which fields to apply
  ↓
Apply selected changes via Shopify productSet mutation
```

---

## Diff Computation

For each `EXISTING_MAPPED` product, compare the incoming supplier data against the Shopify snapshot:

### Product-level fields

```text
title
description
vendor
productType
tags
```

### Variant-level fields

```text
price
compareAtPrice
cost
weight / weightUnit
inventoryQuantity
barcode
```

### Fields explicitly excluded from diff

```text
SKU           — governed by SKU provenance, not general update
images        — separate workflow (future)
options       — variant identity, not data
shopifyProductId / shopifyVariantId — immutable identity
```

### Diff output per product

```text
ProductDiff
  sourceProductKey
  shopifyProductId
  classification: "UPDATE_REVIEW"
  hasChanges: boolean

  productChanges: FieldChange[]
  variantChanges: VariantDiff[]
```

```text
FieldChange
  field          e.g. "title", "vendor"
  shopifyValue   current Shopify value
  supplierValue  incoming supplier value
  selected       boolean — merchant's choice
```

```text
VariantDiff
  sourceVariantKey
  shopifyVariantId
  changes: FieldChange[]
```

---

## Classification Extension

Add `UPDATE_REVIEW` to `ReconciliationClassification`:

```text
EXISTING_MAPPED + has changes  → UPDATE_REVIEW
EXISTING_MAPPED + no changes   → NO_CHANGE
```

Add `UPDATE_PRODUCT` to `ProposedAction`:

```text
UPDATE_REVIEW → proposedAction: UPDATE_PRODUCT
```

The import executor should treat `UPDATE_PRODUCT` as actionable (not skip).

---

## Review UX

### Summary card

```text
1,240 source products

986 no changes
112 have updates
127 new products
15 need review
```

### Update review list

For each product with changes:

```text
┌──────────────────────────────────────────┐
│ Classic Tee                    ☐ Select  │
│ shopify: gid://shopify/Product/12345     │
├──────────────────────────────────────────┤
│ ☑ title      "Classic T-Shirt" → "Classic Tee V2"  │
│ ☐ vendor     "OldBrand"       → "NewBrand"         │
│ ☑ price (S)  $19.99           → $24.99              │
│ ☑ price (M)  $19.99           → $24.99              │
│ ☐ cost  (S)  $8.00            → $9.50               │
└──────────────────────────────────────────┘
```

Each field change has an independent checkbox. Default: **all selected** (opt-out model).

### Bulk actions

```text
[Accept all updates]     — select all fields on all products
[Skip all updates]       — deselect everything
[Accept all for field]   — e.g. "Accept all price changes"
```

### Per-product actions

```text
[Accept all changes]     — select all fields on this product
[Skip this product]      — deselect all fields on this product
[Review variants]        — expand variant-level diff
```

---

## Apply Flow

After merchant confirms:

```text
Selected field changes
  ↓
Build partial productSet mutation
  (only include selected fields)
  ↓
Shopify productSet with product.id (update mode)
  ↓
On success: update snapshot + mapping lastSeenAt
  ↓
On failure: mark as failed, allow retry
```

### productSet update semantics

The Shopify `productSet` mutation supports updates by including the existing product ID:

```text
productSet(input: {
  id: "gid://shopify/Product/12345"
  title: "Classic Tee V2"
  variants: [
    { id: "gid://shopify/ProductVariant/111", price: "24.99" }
  ]
})
```

Only the fields included in the mutation are updated. Omitted fields remain unchanged.

---

## Selective Update Model

Persist the merchant's field selections per product:

```text
UpdateSelection
  catalogRunId
  sourceProductKey
  shopifyProductId
  selectedFields     JSON — [{field, variantIndex?, selected}]
  status             PENDING | APPLIED | FAILED | SKIPPED
```

This allows:

* review now, apply later;
* partial retry on failure;
* audit trail of what was changed and why.

---

## Diff Engine (pure function)

```text
computeProductDiff(
  supplierProduct: CatalogProduct,
  shopifySnapshot: ShopifyProductSnapshot + variants,
  variantMappings: VariantMapping[]
) → ProductDiff
```

The diff engine is a pure function — no DB, no API calls. It:

1. Compares product-level fields (title, description, vendor, productType, tags).
2. For each variant with a mapping, matches the supplier variant to its Shopify variant by fingerprint.
3. Compares variant-level fields (price, compareAtPrice, cost, weight, barcode).
4. Returns a list of `FieldChange` items with `shopifyValue` and `supplierValue`.

A change where both values are falsy (null/undefined/"") is not a change.

---

## API

### GET /api/catalogs/:id/reconciliation/updates

Returns diff for all `UPDATE_REVIEW` products:

```json
{
  "totalWithChanges": 112,
  "products": [
    {
      "sourceProductKey": "classic-tee",
      "shopifyProductId": "gid://shopify/Product/12345",
      "productChanges": [
        { "field": "title", "shopifyValue": "Classic T-Shirt", "supplierValue": "Classic Tee V2", "selected": true }
      ],
      "variantChanges": [
        {
          "sourceVariantKey": "V1",
          "shopifyVariantId": "gid://...",
          "changes": [
            { "field": "price", "shopifyValue": "19.99", "supplierValue": "24.99", "selected": true }
          ]
        }
      ]
    }
  ]
}
```

### POST /api/catalogs/:id/reconciliation/updates/apply

Body:

```json
{
  "selections": [
    {
      "sourceProductKey": "classic-tee",
      "fields": [
        { "field": "title", "selected": true },
        { "field": "vendor", "selected": false },
        { "field": "variants[0].price", "selected": true }
      ]
    }
  ]
}
```

### POST /api/catalogs/:id/reconciliation/updates/apply-all

Apply all detected changes for all products (no field-level selection).

---

## Safety Rules

1. **Never update SKU** through this flow — SKU is governed by the SKU provenance spec.
2. **Never update option names/values** — these are variant identity, not data.
3. **Never clear a Shopify field with a null supplier value** unless merchant explicitly selects it.
4. **Show the Shopify value and supplier value side by side** — the merchant decides.
5. **Persist what was applied** — `UpdateSelection` records create an audit trail.
6. **Failed updates are retryable** — don't lose the selection state.

---

## NO_CHANGE Detection

A product classified as `EXISTING_MAPPED` with zero field differences should be classified as `NO_CHANGE`, not `UPDATE_REVIEW`.

```text
if (diff.productChanges.length === 0 && diff.variantChanges.every(v => v.changes.length === 0)):
    NO_CHANGE
else:
    UPDATE_REVIEW
```

This keeps the review list focused on actual differences.

---

## V1 Scope

* Product-level field diff (title, description, vendor, productType, tags)
* Variant-level field diff (price, compareAtPrice, cost, weight, barcode)
* Per-field selection with default accept-all
* Bulk accept/skip
* `productSet` mutation with existing product ID for updates
* Audit trail via `UpdateSelection`

## Future

* Image diff and selective update
* Inventory quantity sync (separate workflow)
* Auto-accept rules (e.g. "always accept price changes from this supplier")
* Conflict detection when multiple suppliers update the same product
* Batch update with progress tracking

---

## Principle

> Show the merchant what changed. Let them decide what to apply.
> Never silently overwrite Shopify data with supplier data.
