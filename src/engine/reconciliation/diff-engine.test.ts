import { describe, it, expect } from "vitest";
import { computeProductDiff } from "./diff-engine.js";
import type { CatalogProduct } from "@shared/types/catalog.js";
import type { SnapshotProduct, SnapshotVariant, PersistedVariantMapping } from "@shared/types/reconciliation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function supplier(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    sourceKey: "PROD-001",
    title: "Supplier Title",
    vendor: "SupplierVendor",
    tags: [],
    variants: [
      { sourceKey: "V1", sku: "SKU-001", barcode: "BC-001", options: {}, price: "24.99", sourceData: {} },
    ],
    images: [],
    sourceData: {},
    ...overrides,
  };
}

function shopifyProduct(overrides: Partial<SnapshotProduct> = {}): SnapshotProduct {
  return {
    shopifyProductId: "gid://shopify/Product/1",
    title: "Shopify Title",
    handle: "shopify-title",
    vendor: "ShopifyVendor",
    status: "active",
    ...overrides,
  };
}

function shopifyVariant(overrides: Partial<SnapshotVariant> = {}): SnapshotVariant {
  return {
    shopifyVariantId: "gid://shopify/ProductVariant/1",
    shopifyProductId: "gid://shopify/Product/1",
    sku: "SKU-001",
    barcode: "BC-001",
    option1: null,
    option2: null,
    option3: null,
    ...overrides,
  };
}

function variantMapping(overrides: Partial<PersistedVariantMapping> = {}): PersistedVariantMapping {
  return {
    id: "vm-1",
    sourceVariantKey: "V1",
    sourceVariantFingerprint: "v1",
    shopifyVariantId: "gid://shopify/ProductVariant/1",
    sourceSku: "SKU-001",
    barcode: "BC-001",
    shopifySku: "SKU-001",
    skuSource: "SUPPLIER",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Product-level diffs
// ---------------------------------------------------------------------------

describe("computeProductDiff — product fields", () => {
  it("detects title change", () => {
    const diff = computeProductDiff(
      supplier({ title: "New Title", vendor: "SameVendor" }),
      shopifyProduct({ title: "Old Title", vendor: "SameVendor" }),
      [],
      [],
    );

    expect(diff.hasChanges).toBe(true);
    expect(diff.productChanges).toHaveLength(1);
    expect(diff.productChanges[0].field).toBe("title");
    expect(diff.productChanges[0].shopifyValue).toBe("Old Title");
    expect(diff.productChanges[0].supplierValue).toBe("New Title");
    expect(diff.productChanges[0].selected).toBe(true);
  });

  it("detects vendor change", () => {
    const diff = computeProductDiff(
      supplier({ vendor: "NewVendor" }),
      shopifyProduct({ vendor: "OldVendor" }),
      [],
      [],
    );

    const vendorChange = diff.productChanges.find((c) => c.field === "vendor");
    expect(vendorChange).toBeDefined();
    expect(vendorChange!.shopifyValue).toBe("OldVendor");
    expect(vendorChange!.supplierValue).toBe("NewVendor");
  });

  it("detects multiple field changes", () => {
    const diff = computeProductDiff(
      supplier({ title: "New Title", vendor: "NewVendor" }),
      shopifyProduct({ title: "Old Title", vendor: "OldVendor" }),
      [],
      [],
    );

    expect(diff.productChanges).toHaveLength(2);
  });

  it("reports no changes when fields match", () => {
    const diff = computeProductDiff(
      supplier({ title: "Same Title", vendor: "Same Vendor" }),
      shopifyProduct({ title: "Same Title", vendor: "Same Vendor" }),
      [],
      [],
    );

    expect(diff.hasChanges).toBe(false);
    expect(diff.productChanges).toHaveLength(0);
  });

  it("ignores both-null fields", () => {
    const diff = computeProductDiff(
      supplier({ vendor: undefined }),
      shopifyProduct({ vendor: null }),
      [],
      [],
    );

    // Both are effectively empty — not a change
    const vendorChange = diff.productChanges.find((c) => c.field === "vendor");
    expect(vendorChange).toBeUndefined();
  });

  it("detects null→value change", () => {
    const diff = computeProductDiff(
      supplier({ vendor: "NewVendor" }),
      shopifyProduct({ vendor: null }),
      [],
      [],
    );

    const vendorChange = diff.productChanges.find((c) => c.field === "vendor");
    expect(vendorChange).toBeDefined();
    expect(vendorChange!.shopifyValue).toBeNull();
    expect(vendorChange!.supplierValue).toBe("NewVendor");
  });

  it("trims whitespace before comparing", () => {
    const diff = computeProductDiff(
      supplier({ title: "  Same Title  " }),
      shopifyProduct({ title: "Same Title" }),
      [],
      [],
    );

    expect(diff.productChanges.find((c) => c.field === "title")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Variant-level diffs
// ---------------------------------------------------------------------------

describe("computeProductDiff — variant fields", () => {
  it("detects barcode change on mapped variant", () => {
    const diff = computeProductDiff(
      supplier({
        variants: [{ sourceKey: "V1", sku: "SKU-001", barcode: "NEW-BC", options: {}, sourceData: {} }],
      }),
      shopifyProduct(),
      [shopifyVariant({ barcode: "OLD-BC" })],
      [variantMapping()],
    );

    expect(diff.variantChanges).toHaveLength(1);
    expect(diff.variantChanges[0].sourceVariantKey).toBe("V1");
    expect(diff.variantChanges[0].changes[0].field).toBe("barcode");
    expect(diff.variantChanges[0].changes[0].shopifyValue).toBe("OLD-BC");
    expect(diff.variantChanges[0].changes[0].supplierValue).toBe("NEW-BC");
  });

  it("reports no variant changes when barcodes match", () => {
    const diff = computeProductDiff(
      supplier({
        variants: [{ sourceKey: "V1", sku: "SKU-001", barcode: "BC-001", options: {}, sourceData: {} }],
      }),
      shopifyProduct(),
      [shopifyVariant({ barcode: "BC-001" })],
      [variantMapping()],
    );

    expect(diff.variantChanges).toHaveLength(0);
  });

  it("skips variants without a mapping", () => {
    const diff = computeProductDiff(
      supplier({
        variants: [
          { sourceKey: "V1", sku: "SKU-001", barcode: "NEW-BC", options: {}, sourceData: {} },
          { sourceKey: "V-NEW", sku: "SKU-NEW", barcode: "BC-NEW", options: {}, sourceData: {} },
        ],
      }),
      shopifyProduct(),
      [shopifyVariant()],
      [variantMapping()], // only V1 is mapped
    );

    // Only V1 should appear in variant changes, not V-NEW
    expect(diff.variantChanges.length).toBeLessThanOrEqual(1);
  });

  it("SKU is explicitly excluded from diff", () => {
    // Variant has different SKU from Shopify — should NOT appear in diff
    // because SKU is governed by the provenance spec
    const diff = computeProductDiff(
      supplier({
        variants: [{ sourceKey: "V1", sku: "NEW-SKU", barcode: "BC-001", options: {}, sourceData: {} }],
      }),
      shopifyProduct(),
      [shopifyVariant({ sku: "OLD-SKU", barcode: "BC-001" })],
      [variantMapping()],
    );

    // Barcode matches, no change. SKU difference should be invisible.
    const skuChange = diff.variantChanges
      .flatMap((v) => v.changes)
      .find((c) => c.field === "sku");
    expect(skuChange).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hasChanges flag
// ---------------------------------------------------------------------------

describe("computeProductDiff — hasChanges", () => {
  it("true when product field differs", () => {
    const diff = computeProductDiff(
      supplier({ title: "Changed" }),
      shopifyProduct({ title: "Original" }),
      [],
      [],
    );
    expect(diff.hasChanges).toBe(true);
  });

  it("true when variant field differs", () => {
    const diff = computeProductDiff(
      supplier({
        title: "Same",
        vendor: "Same",
        variants: [{ sourceKey: "V1", barcode: "NEW", options: {}, sourceData: {} }],
      }),
      shopifyProduct({ title: "Same", vendor: "Same" }),
      [shopifyVariant({ barcode: "OLD" })],
      [variantMapping()],
    );
    expect(diff.hasChanges).toBe(true);
  });

  it("false when everything matches", () => {
    const diff = computeProductDiff(
      supplier({ title: "Same", vendor: "Same" }),
      shopifyProduct({ title: "Same", vendor: "Same" }),
      [],
      [],
    );
    expect(diff.hasChanges).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Default selection
// ---------------------------------------------------------------------------

describe("computeProductDiff — default selection", () => {
  it("all changes default to selected=true", () => {
    const diff = computeProductDiff(
      supplier({ title: "New", vendor: "New" }),
      shopifyProduct({ title: "Old", vendor: "Old" }),
      [],
      [],
    );

    for (const change of diff.productChanges) {
      expect(change.selected).toBe(true);
    }
  });
});
