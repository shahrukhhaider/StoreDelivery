/**
 * Tests for buildStoredDiff — the pure function that serializes a ProductDiff
 * into the compact StoredDiff shape written to ImportItem.appliedDiff.
 *
 * Also exercises the full computeProductDiff → buildStoredDiff roundtrip to
 * verify that before-values (shopifyValue) are correctly captured as rollback
 * targets and after-values (supplierValue) reflect what was applied.
 */

import { describe, it, expect } from "vitest";
import { buildStoredDiff } from "./diff-serializer.js";
import { computeProductDiff } from "../../engine/reconciliation/diff-engine.js";
import type { FieldChange, VariantDiff, SnapshotProduct, SnapshotVariant, PersistedVariantMapping } from "@shared/types/reconciliation.js";
import type { CatalogProduct } from "@shared/types/catalog.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function fc(
  field: string,
  shopifyValue: string | null,
  supplierValue: string | null,
  selected = true,
): FieldChange {
  return { field, shopifyValue, supplierValue, selected };
}

function vd(
  sourceVariantKey: string,
  changes: FieldChange[],
  status: VariantDiff["status"] = "changed",
  shopifyVariantId: string | null = "gid://shopify/ProductVariant/1",
): VariantDiff {
  return { sourceVariantKey, shopifyVariantId, changes, status };
}

function supplierProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    sourceKey: "test-product",
    title: "New Title",
    vendor: "Vendor",
    tags: [],
    variants: [
      { sourceKey: "V1", sku: "SKU-1", barcode: null, options: {}, price: "29.99", sourceData: {} },
    ],
    images: [],
    sourceData: {},
    ...overrides,
  };
}

function shopifySnapshotProduct(overrides: Partial<SnapshotProduct> = {}): SnapshotProduct {
  return {
    shopifyProductId: "gid://shopify/Product/1",
    title: "Old Title",
    description: null,
    handle: "old-title",
    vendor: "Vendor",
    productType: null,
    status: "active",
    tags: [],
    images: [],
    ...overrides,
  };
}

function shopifySnapshotVariant(overrides: Partial<SnapshotVariant> = {}): SnapshotVariant {
  return {
    shopifyVariantId: "gid://shopify/ProductVariant/1",
    shopifyProductId: "gid://shopify/Product/1",
    inventoryItemId: "gid://shopify/InventoryItem/1",
    sku: "SKU-1",
    barcode: null,
    price: "24.99",
    compareAtPrice: null,
    cost: null,
    inventoryQuantity: 10,
    inventoryPolicy: "DENY",
    taxable: true,
    weight: null,
    weightUnit: null,
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
    sourceVariantFingerprint: "sku:sku-1",
    shopifyVariantId: "gid://shopify/ProductVariant/1",
    sourceSku: "SKU-1",
    barcode: null,
    shopifySku: "SKU-1",
    skuSource: "SUPPLIER",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildStoredDiff — unit tests
// ---------------------------------------------------------------------------

describe("buildStoredDiff", () => {
  it("serializes product-level changes, stripping selected flag", () => {
    const productChanges = [fc("title", "Old Title", "New Title")];
    const result = buildStoredDiff(productChanges, []);

    expect(result.productChanges).toHaveLength(1);
    expect(result.productChanges[0]).toEqual({
      field: "title",
      shopifyValue: "Old Title",
      supplierValue: "New Title",
    });
    // selected must not be present
    expect(result.productChanges[0]).not.toHaveProperty("selected");
  });

  it("serializes variant-level field changes", () => {
    const variantChanges = [
      vd("V1", [fc("price", "24.99", "29.99")]),
    ];
    const result = buildStoredDiff([], variantChanges);

    expect(result.variantChanges).toHaveLength(1);
    expect(result.variantChanges[0].sourceVariantKey).toBe("V1");
    expect(result.variantChanges[0].status).toBe("changed");
    expect(result.variantChanges[0].changes).toHaveLength(1);
    expect(result.variantChanges[0].changes[0]).toEqual({
      field: "price",
      shopifyValue: "24.99",
      supplierValue: "29.99",
    });
  });

  it("excludes unselected product changes", () => {
    const productChanges = [
      fc("title", "Old", "New", true),
      fc("vendor", "OldVendor", "NewVendor", false), // not selected
    ];
    const result = buildStoredDiff(productChanges, []);

    expect(result.productChanges).toHaveLength(1);
    expect(result.productChanges[0].field).toBe("title");
  });

  it("excludes unselected variant changes and skips variant with no selected changes", () => {
    const variantChanges = [
      vd("V1", [fc("price", "10", "20", false)]), // no selected changes
      vd("V2", [fc("price", "15", "25", true)]),
    ];
    const result = buildStoredDiff([], variantChanges);

    // V1 has no selected changes and is not added/discontinued — excluded
    expect(result.variantChanges).toHaveLength(1);
    expect(result.variantChanges[0].sourceVariantKey).toBe("V2");
  });

  it("includes added variants even with no field changes", () => {
    const variantChanges = [
      vd("V-NEW", [], "added", null),
    ];
    const result = buildStoredDiff([], variantChanges);

    expect(result.variantChanges).toHaveLength(1);
    expect(result.variantChanges[0].sourceVariantKey).toBe("V-NEW");
    expect(result.variantChanges[0].status).toBe("added");
    expect(result.variantChanges[0].shopifyVariantId).toBeNull();
    expect(result.variantChanges[0].changes).toHaveLength(0);
  });

  it("includes discontinued variants even with no field changes", () => {
    const variantChanges = [
      vd("V-OLD", [], "discontinued", "gid://shopify/ProductVariant/99"),
    ];
    const result = buildStoredDiff([], variantChanges);

    expect(result.variantChanges).toHaveLength(1);
    expect(result.variantChanges[0].status).toBe("discontinued");
    expect(result.variantChanges[0].shopifyVariantId).toBe("gid://shopify/ProductVariant/99");
  });

  it("returns empty arrays when there are no changes", () => {
    const result = buildStoredDiff([], []);
    expect(result.productChanges).toHaveLength(0);
    expect(result.variantChanges).toHaveLength(0);
  });

  it("defaults variant status to 'changed' when status is undefined", () => {
    const v: VariantDiff = {
      sourceVariantKey: "V1",
      shopifyVariantId: "gid://shopify/ProductVariant/1",
      changes: [fc("price", "10", "20")],
      // status intentionally omitted
    };
    const result = buildStoredDiff([], [v]);

    expect(result.variantChanges[0].status).toBe("changed");
  });

  it("handles null shopifyVariantId in changed variant", () => {
    const variantChanges = [
      vd("V1", [fc("price", "10", "20")], "changed", null),
    ];
    const result = buildStoredDiff([], variantChanges);

    expect(result.variantChanges[0].shopifyVariantId).toBeNull();
  });

  it("preserves null shopifyValue (empty before-value) as rollback target", () => {
    const productChanges = [fc("description", null, "New description")];
    const result = buildStoredDiff(productChanges, []);

    expect(result.productChanges[0].shopifyValue).toBeNull();
    expect(result.productChanges[0].supplierValue).toBe("New description");
  });
});

// ---------------------------------------------------------------------------
// computeProductDiff → buildStoredDiff roundtrip tests
// ---------------------------------------------------------------------------

describe("computeProductDiff → buildStoredDiff roundtrip", () => {
  it("captures price change: shopifyValue is the before-price (rollback target)", () => {
    const supplier = supplierProduct({
      variants: [{ sourceKey: "V1", sku: "SKU-1", barcode: null, options: {}, price: "39.99", sourceData: {} }],
    });
    const diff = computeProductDiff(
      supplier,
      shopifySnapshotProduct(),
      [shopifySnapshotVariant({ price: "24.99" })],
      [variantMapping()],
    );

    const productChanges = diff.productChanges.map((c) => ({ ...c, selected: true }));
    const variantChanges = diff.variantChanges.map((v) => ({
      ...v,
      changes: v.changes.map((c) => ({ ...c, selected: true })),
    }));
    const stored = buildStoredDiff(productChanges, variantChanges);

    const priceChange = stored.variantChanges[0]?.changes.find((c) => c.field === "price");
    expect(priceChange).toBeDefined();
    expect(priceChange!.shopifyValue).toBe("24.99");  // before — rollback target
    expect(priceChange!.supplierValue).toBe("39.99"); // after — what was applied
  });

  it("captures title change at product level", () => {
    const supplier = supplierProduct({ title: "Updated Title" });
    const diff = computeProductDiff(
      supplier,
      shopifySnapshotProduct({ title: "Original Title" }),
      [shopifySnapshotVariant()],
      [variantMapping()],
    );

    const productChanges = diff.productChanges.map((c) => ({ ...c, selected: true }));
    const stored = buildStoredDiff(productChanges, []);

    const titleChange = stored.productChanges.find((c) => c.field === "title");
    expect(titleChange).toBeDefined();
    expect(titleChange!.shopifyValue).toBe("Original Title");
    expect(titleChange!.supplierValue).toBe("Updated Title");
  });

  it("captures inventoryQuantity change", () => {
    const supplier = supplierProduct({
      variants: [{ sourceKey: "V1", sku: "SKU-1", barcode: null, options: {}, price: "24.99", inventoryQuantity: 50, sourceData: {} }],
    });
    const diff = computeProductDiff(
      supplier,
      shopifySnapshotProduct(),
      [shopifySnapshotVariant({ inventoryQuantity: 10 })],
      [variantMapping()],
    );

    const variantChanges = diff.variantChanges.map((v) => ({
      ...v,
      changes: v.changes.map((c) => ({ ...c, selected: true })),
    }));
    const stored = buildStoredDiff([], variantChanges);

    const qtyChange = stored.variantChanges[0]?.changes.find((c) => c.field === "inventoryQuantity");
    expect(qtyChange).toBeDefined();
    expect(qtyChange!.shopifyValue).toBe("10");
    expect(qtyChange!.supplierValue).toBe("50");
  });

  it("produces empty storedDiff when supplier matches Shopify exactly", () => {
    // Supplier and Shopify have identical price — diff engine emits no changes
    const supplier = supplierProduct(); // price: "29.99"
    const diff = computeProductDiff(
      supplier,
      shopifySnapshotProduct({ title: "New Title" }), // title matches supplier
      [shopifySnapshotVariant({ price: "29.99" })],    // price matches supplier
      [variantMapping()],
    );

    const productChanges = diff.productChanges.map((c) => ({ ...c, selected: true }));
    const variantChanges = diff.variantChanges.map((v) => ({
      ...v,
      changes: v.changes.map((c) => ({ ...c, selected: true })),
    }));
    const stored = buildStoredDiff(productChanges, variantChanges);

    expect(stored.productChanges).toHaveLength(0);
    expect(stored.variantChanges).toHaveLength(0);
  });

  it("produces combined product + variant changes", () => {
    const supplier = supplierProduct({
      title: "New Title",
      variants: [{ sourceKey: "V1", sku: "SKU-1", barcode: null, options: {}, price: "39.99", sourceData: {} }],
    });
    const diff = computeProductDiff(
      supplier,
      shopifySnapshotProduct({ title: "Old Title" }),
      [shopifySnapshotVariant({ price: "24.99" })],
      [variantMapping()],
    );

    const productChanges = diff.productChanges.map((c) => ({ ...c, selected: true }));
    const variantChanges = diff.variantChanges.map((v) => ({
      ...v,
      changes: v.changes.map((c) => ({ ...c, selected: true })),
    }));
    const stored = buildStoredDiff(productChanges, variantChanges);

    expect(stored.productChanges.some((c) => c.field === "title")).toBe(true);
    expect(stored.variantChanges[0].changes.some((c) => c.field === "price")).toBe(true);
  });

  it("does not include selected:false in stored output (stripped from API shape)", () => {
    const productChanges = [fc("title", "Old", "New", true)];
    const stored = buildStoredDiff(productChanges, []);

    // The stored shape must not carry the selected boolean
    const keys = Object.keys(stored.productChanges[0]);
    expect(keys).toContain("field");
    expect(keys).toContain("shopifyValue");
    expect(keys).toContain("supplierValue");
    expect(keys).not.toContain("selected");
  });
});
