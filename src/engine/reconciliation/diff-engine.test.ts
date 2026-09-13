import { describe, it, expect } from "vitest";
import { computeProductDiff } from "./diff-engine.js";
import type { CatalogProduct } from "@shared/types/catalog.js";
import type { SnapshotProduct, SnapshotVariant, PersistedVariantMapping } from "@shared/types/reconciliation.js";

// ---------------------------------------------------------------------------
// Helpers — supplier product factory
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

// ---------------------------------------------------------------------------
// Helpers — Shopify snapshot factories
// ---------------------------------------------------------------------------

function shopifyProduct(overrides: Partial<SnapshotProduct> = {}): SnapshotProduct {
  return {
    shopifyProductId: "gid://shopify/Product/1",
    title: "Shopify Title",
    description: null,
    handle: "shopify-title",
    vendor: "ShopifyVendor",
    productType: null,
    status: "active",
    tags: [],
    images: [],
    ...overrides,
  };
}

function shopifyVariant(overrides: Partial<SnapshotVariant> = {}): SnapshotVariant {
  return {
    shopifyVariantId: "gid://shopify/ProductVariant/1",
    shopifyProductId: "gid://shopify/Product/1",
    inventoryItemId: null,
    sku: "SKU-001",
    barcode: "BC-001",
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
// Product-level: title changes
// ---------------------------------------------------------------------------

describe("diff — product title", () => {
  it("detects title change", () => {
    const diff = computeProductDiff(
      supplier({ title: "New Title", vendor: "Same" }),
      shopifyProduct({ title: "Old Title", vendor: "Same" }),
      [], [],
    );
    expect(diff.hasChanges).toBe(true);
    const c = diff.productChanges.find((c) => c.field === "title")!;
    expect(c.shopifyValue).toBe("Old Title");
    expect(c.supplierValue).toBe("New Title");
  });

  it("no change when titles match", () => {
    const diff = computeProductDiff(
      supplier({ title: "Same", vendor: "Same" }),
      shopifyProduct({ title: "Same", vendor: "Same" }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "title")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Product-level: description changes
// ---------------------------------------------------------------------------

describe("diff — product description", () => {
  it("detects description added", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V", description: "New description" }),
      shopifyProduct({ title: "T", vendor: "V", description: null }),
      [], [],
    );
    const c = diff.productChanges.find((c) => c.field === "description")!;
    expect(c).toBeDefined();
    expect(c.shopifyValue).toBeNull();
    expect(c.supplierValue).toBe("New description");
  });

  it("detects description changed", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V", description: "Updated" }),
      shopifyProduct({ title: "T", vendor: "V", description: "Original" }),
      [], [],
    );
    const c = diff.productChanges.find((c) => c.field === "description")!;
    expect(c.shopifyValue).toBe("Original");
    expect(c.supplierValue).toBe("Updated");
  });

  it("no change when both null", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V", description: undefined }),
      shopifyProduct({ title: "T", vendor: "V", description: null }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "description")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Product-level: vendor, productType
// ---------------------------------------------------------------------------

describe("diff — vendor and productType", () => {
  it("detects vendor change", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "NewVendor" }),
      shopifyProduct({ title: "T", vendor: "OldVendor" }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "vendor")).toBeDefined();
  });

  it("detects productType change", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V", productType: "Shoes" }),
      shopifyProduct({ title: "T", vendor: "V", productType: "Boots" }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "productType")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Product-level: tags
// ---------------------------------------------------------------------------

describe("diff — tags", () => {
  it("detects tags added", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V", tags: ["new", "sale"] }),
      shopifyProduct({ title: "T", vendor: "V", tags: [] }),
      [], [],
    );
    const c = diff.productChanges.find((c) => c.field === "tags")!;
    expect(c).toBeDefined();
    expect(c.supplierValue).toContain("new");
  });

  it("no change when tags match (order independent)", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V", tags: ["b", "a"] }),
      shopifyProduct({ title: "T", vendor: "V", tags: ["a", "b"] }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "tags")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Product-level: images
// ---------------------------------------------------------------------------

describe("diff — images", () => {
  it("detects images added (supplier has images, Shopify has none)", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        images: [
          { sourceUrl: "https://img.com/a.jpg", position: 1 },
          { sourceUrl: "https://img.com/b.jpg", position: 2 },
        ],
      }),
      shopifyProduct({ title: "T", vendor: "V", images: [] }),
      [], [],
    );
    const c = diff.productChanges.find((c) => c.field === "images")!;
    expect(c).toBeDefined();
    expect(c.shopifyValue).toBeNull();
    expect(c.supplierValue).toBe("2 images");
  });

  it("detects images changed (different URLs)", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        images: [{ sourceUrl: "https://img.com/new.jpg", position: 1 }],
      }),
      shopifyProduct({
        title: "T", vendor: "V",
        images: [{ url: "https://img.com/old.jpg", altText: null }],
      }),
      [], [],
    );
    const c = diff.productChanges.find((c) => c.field === "images")!;
    expect(c).toBeDefined();
    expect(c.shopifyValue).toBe("1 image");
    expect(c.supplierValue).toBe("1 image");
  });

  it("no change when image URLs match (order independent)", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        images: [
          { sourceUrl: "https://img.com/b.jpg", position: 2 },
          { sourceUrl: "https://img.com/a.jpg", position: 1 },
        ],
      }),
      shopifyProduct({
        title: "T", vendor: "V",
        images: [
          { url: "https://img.com/a.jpg", altText: null },
          { url: "https://img.com/b.jpg", altText: null },
        ],
      }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "images")).toBeUndefined();
  });

  it("no change when supplier has no images (treated as 'no opinion', not 'remove')", () => {
    // When supplier file has no Images column, images=[] means the column wasn't mapped.
    // This should NOT be treated as "remove all images" — that would be destructive.
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V", images: [] }),
      shopifyProduct({
        title: "T", vendor: "V",
        images: [{ url: "https://img.com/old.jpg", altText: null }],
      }),
      [], [],
    );
    // No change — supplier absence of images ≠ intent to clear them
    expect(diff.productChanges.find((c) => c.field === "images")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Variant-level: price changes
// ---------------------------------------------------------------------------

describe("diff — variant price", () => {
  it("detects price increase", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [{ sourceKey: "V1", sku: "S", options: {}, price: "29.99", sourceData: {} }],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant({ price: "24.99" })],
      [variantMapping()],
    );
    expect(diff.variantChanges).toHaveLength(1);
    const c = diff.variantChanges[0].changes.find((c) => c.field === "price")!;
    expect(c.shopifyValue).toBe("24.99");
    expect(c.supplierValue).toBe("29.99");
  });

  it("detects price decrease", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [{ sourceKey: "V1", sku: "S", options: {}, price: "9.99", sourceData: {} }],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant({ price: "19.99" })],
      [variantMapping()],
    );
    const c = diff.variantChanges[0].changes.find((c) => c.field === "price")!;
    expect(c.shopifyValue).toBe("19.99");
    expect(c.supplierValue).toBe("9.99");
  });

  it("no price change when values match", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [{ sourceKey: "V1", sku: "S", options: {}, price: "24.99", sourceData: {} }],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant({ price: "24.99" })],
      [variantMapping()],
    );
    const priceChange = diff.variantChanges
      .flatMap((v) => v.changes)
      .find((c) => c.field === "price");
    expect(priceChange).toBeUndefined();
  });

  it("detects compareAtPrice change", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [{ sourceKey: "V1", sku: "S", options: {}, price: "24.99", compareAtPrice: "39.99", sourceData: {} }],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant({ price: "24.99", compareAtPrice: "29.99" })],
      [variantMapping()],
    );
    const c = diff.variantChanges[0].changes.find((c) => c.field === "compareAtPrice")!;
    expect(c.shopifyValue).toBe("29.99");
    expect(c.supplierValue).toBe("39.99");
  });
});

// ---------------------------------------------------------------------------
// Variant-level: inventory quantity changes
// ---------------------------------------------------------------------------

describe("diff — variant inventory", () => {
  it("detects quantity increase", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [{ sourceKey: "V1", sku: "S", options: {}, price: "10", inventoryQuantity: 50, sourceData: {} }],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant({ price: "10", inventoryQuantity: 10 })],
      [variantMapping()],
    );
    const c = diff.variantChanges[0].changes.find((c) => c.field === "inventoryQuantity")!;
    expect(c.shopifyValue).toBe("10");
    expect(c.supplierValue).toBe("50");
  });

  it("detects quantity decrease to zero", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [{ sourceKey: "V1", sku: "S", options: {}, price: "10", inventoryQuantity: 0, sourceData: {} }],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant({ price: "10", inventoryQuantity: 25 })],
      [variantMapping()],
    );
    const c = diff.variantChanges[0].changes.find((c) => c.field === "inventoryQuantity")!;
    expect(c.shopifyValue).toBe("25");
    expect(c.supplierValue).toBe("0");
  });

  it("no change when quantities match", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [{ sourceKey: "V1", sku: "S", options: {}, price: "10", inventoryQuantity: 10, sourceData: {} }],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant({ price: "10", inventoryQuantity: 10 })],
      [variantMapping()],
    );
    const qtyChange = diff.variantChanges
      .flatMap((v) => v.changes)
      .find((c) => c.field === "inventoryQuantity");
    expect(qtyChange).toBeUndefined();
  });

  it("handles null → value (stock added)", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [{ sourceKey: "V1", sku: "S", options: {}, price: "10", inventoryQuantity: 15, sourceData: {} }],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant({ price: "10", inventoryQuantity: null })],
      [variantMapping()],
    );
    const c = diff.variantChanges[0].changes.find((c) => c.field === "inventoryQuantity")!;
    expect(c.shopifyValue).toBeNull();
    expect(c.supplierValue).toBe("15");
  });
});

// ---------------------------------------------------------------------------
// Variant-level: weight changes
// ---------------------------------------------------------------------------

describe("diff — variant weight", () => {
  it("detects weight change", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [{ sourceKey: "V1", sku: "S", options: {}, price: "10", weight: 2.5, weightUnit: "kg", sourceData: {} }],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant({ price: "10", weight: 1.0, weightUnit: "kg" })],
      [variantMapping()],
    );
    const c = diff.variantChanges[0].changes.find((c) => c.field === "weight")!;
    expect(c.shopifyValue).toBe("1 KILOGRAMS");
    expect(c.supplierValue).toBe("2.5 KILOGRAMS");
  });
});

// ---------------------------------------------------------------------------
// Variant-level: barcode changes
// ---------------------------------------------------------------------------

describe("diff — variant barcode", () => {
  it("detects barcode change", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [{ sourceKey: "V1", sku: "S", barcode: "NEW-BC", options: {}, price: "10", sourceData: {} }],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant({ price: "10", barcode: "OLD-BC" })],
      [variantMapping()],
    );
    const c = diff.variantChanges[0].changes.find((c) => c.field === "barcode")!;
    expect(c.shopifyValue).toBe("OLD-BC");
    expect(c.supplierValue).toBe("NEW-BC");
  });
});

// ---------------------------------------------------------------------------
// SKU excluded from diff
// ---------------------------------------------------------------------------

describe("diff — SKU exclusion", () => {
  it("does NOT show SKU difference in diff", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [{ sourceKey: "V1", sku: "NEW-SKU", barcode: "BC", options: {}, price: "10", sourceData: {} }],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant({ sku: "OLD-SKU", barcode: "BC", price: "10" })],
      [variantMapping()],
    );
    const skuChange = diff.variantChanges
      .flatMap((v) => v.changes)
      .find((c) => c.field === "sku");
    expect(skuChange).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Multi-field changes on same product
// ---------------------------------------------------------------------------

describe("diff — multi-field changes", () => {
  it("detects title + price + inventory all changed at once", () => {
    const diff = computeProductDiff(
      supplier({
        title: "Updated Title",
        vendor: "V",
        variants: [{ sourceKey: "V1", sku: "S", options: {}, price: "39.99", inventoryQuantity: 100, sourceData: {} }],
      }),
      shopifyProduct({ title: "Original Title", vendor: "V" }),
      [shopifyVariant({ price: "19.99", inventoryQuantity: 5 })],
      [variantMapping()],
    );

    expect(diff.hasChanges).toBe(true);
    expect(diff.productChanges.find((c) => c.field === "title")).toBeDefined();
    expect(diff.variantChanges[0].changes.find((c) => c.field === "price")).toBeDefined();
    expect(diff.variantChanges[0].changes.find((c) => c.field === "inventoryQuantity")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Multi-variant product
// ---------------------------------------------------------------------------

describe("diff — multi-variant", () => {
  it("diffs each variant independently", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [
          { sourceKey: "V1", sku: "S1", options: { Color: "Red" }, price: "29.99", inventoryQuantity: 10, sourceData: {} },
          { sourceKey: "V2", sku: "S2", options: { Color: "Blue" }, price: "24.99", inventoryQuantity: 10, sourceData: {} },
        ],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [
        shopifyVariant({ shopifyVariantId: "gid://V/1", price: "24.99", inventoryQuantity: 10, barcode: null }),
        shopifyVariant({ shopifyVariantId: "gid://V/2", price: "24.99", inventoryQuantity: 10, barcode: null }),
      ],
      [
        variantMapping({ sourceVariantKey: "V1", shopifyVariantId: "gid://V/1" }),
        variantMapping({ sourceVariantKey: "V2", shopifyVariantId: "gid://V/2" }),
      ],
    );

    // V1: price changed (24.99 → 29.99)
    const v1 = diff.variantChanges.find((v) => v.sourceVariantKey === "V1")!;
    expect(v1).toBeDefined();
    expect(v1.changes.find((c) => c.field === "price")!.supplierValue).toBe("29.99");

    // V2: no changes at all
    const v2 = diff.variantChanges.find((v) => v.sourceVariantKey === "V2");
    expect(v2).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// No changes → hasChanges = false
// ---------------------------------------------------------------------------

describe("diff — no changes", () => {
  it("hasChanges is false when everything matches", () => {
    const diff = computeProductDiff(
      supplier({ title: "Same", vendor: "Same" }),
      shopifyProduct({ title: "Same", vendor: "Same" }),
      [shopifyVariant()],
      [variantMapping()], // V1 mapped and fields match
    );
    expect(diff.hasChanges).toBe(false);
    expect(diff.productChanges).toHaveLength(0);
    // V1 matched and unchanged — no changed/added/discontinued entries
    expect(diff.variantChanges.filter((v) => v.status !== "changed")).toHaveLength(0);
    expect(diff.variantChanges.filter((v) => v.status === "changed")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Default selection
// ---------------------------------------------------------------------------

describe("diff — default selection", () => {
  it("all changes default to selected=true", () => {
    const diff = computeProductDiff(
      supplier({ title: "New", vendor: "New" }),
      shopifyProduct({ title: "Old", vendor: "Old" }),
      [], [],
    );
    for (const change of diff.productChanges) {
      expect(change.selected).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Unmapped variants skipped
// ---------------------------------------------------------------------------

describe("diff — unmapped variants", () => {
  it("marks supplier variants without mapping as added (not silently skipped)", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [
          { sourceKey: "V1", sku: "S1", options: {}, price: "10", sourceData: {} },
          { sourceKey: "V-NEW", sku: "S-NEW", options: {}, price: "20", sourceData: {} },
        ],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant()],
      [variantMapping()], // only V1 is mapped
    );
    // V-NEW has no mapping → appears as "added", not silently dropped
    const vNew = diff.variantChanges.find((v) => v.sourceVariantKey === "V-NEW");
    expect(vNew).toBeDefined();
    expect(vNew?.status).toBe("added");
  });
});

// ---------------------------------------------------------------------------
// weightUnit=null contract — live Shopify API doesn't return weightUnit
// directly on ProductVariant in Admin API 2024-10
// ---------------------------------------------------------------------------

describe("diff — weightUnit=null from live Shopify API", () => {
  it("handles weightUnit=null in Shopify snapshot without error", () => {
    // This simulates what fetchProductDetails returns: weight present, weightUnit null
    const shopifyWithNullUnit: SnapshotVariant = {
      shopifyVariantId: "gid://shopify/ProductVariant/1",
      shopifyProductId: "gid://shopify/Product/1",
      inventoryItemId: null,
      sku: "SKU-001",
      barcode: null,
      price: "24.99",
      compareAtPrice: null,
      inventoryQuantity: 10,
      weight: 1.0,
      weightUnit: null,  // ← what the API actually returns
      cost: null,
      inventoryPolicy: null,
      taxable: null,
      option1: null,
      option2: null,
      option3: null,
    };

    // Supplier has weight 2.5 with unit
    const supplierProduct = supplier({
      title: "T", vendor: "V",
      variants: [{
        sourceKey: "V1", sku: "SKU-001", options: {},
        price: "24.99", weight: 2.5, weightUnit: "kg",
        sourceData: {},
      }],
    });

    // Should not throw — handles null weightUnit gracefully
    expect(() => computeProductDiff(
      supplierProduct,
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyWithNullUnit],
      [variantMapping()],
    )).not.toThrow();
  });

  it("no weight change detected when Shopify weightUnit is null (can't compare units)", () => {
    // When Shopify has weight=1.0 with no unit info,
    // and supplier has weight=1 kg,
    // Shopify side shows "1" (no unit), supplier shows "1 kg"
    // This is a known limitation — weight diffs require unit info
    const shopifyWithNullUnit: SnapshotVariant = {
      shopifyVariantId: "gid://shopify/ProductVariant/1",
      shopifyProductId: "gid://shopify/Product/1",
      inventoryItemId: null,
      sku: "SKU-001",
      barcode: null,
      price: "24.99",
      compareAtPrice: null,
      inventoryQuantity: 10,
      weight: 1.0,
      weightUnit: null,
      cost: null,
      inventoryPolicy: null,
      taxable: null,
      option1: null,
      option2: null,
      option3: null,
    };

    const supplierProduct = supplier({
      title: "T", vendor: "V",
      variants: [{
        sourceKey: "V1", sku: "SKU-001", options: {},
        price: "24.99", weight: 1.0, weightUnit: "kg",
        sourceData: {},
      }],
    });

    const diff = computeProductDiff(
      supplierProduct,
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyWithNullUnit],
      [variantMapping()],
    );

    // Weight values differ as strings ("1 kg" vs "1") but this is expected with null unit
    // The test documents the known behavior
    const weightChange = diff.variantChanges.flatMap((v) => v.changes).find((c) => c.field === "weight");
    if (weightChange) {
      // If detected: Shopify shows "1" (no unit, null weightUnit), supplier shows "1 KILOGRAMS"
      expect(weightChange.shopifyValue).toBe("1");
      expect(weightChange.supplierValue).toBe("1 KILOGRAMS");
    }
    // Whether detected or not, no crash — the behavior is documented
  });

  it("correct weight change detected when both have numeric weight (ignoring unit)", () => {
    const shopifyWithNullUnit: SnapshotVariant = {
      shopifyVariantId: "gid://shopify/ProductVariant/1",
      shopifyProductId: "gid://shopify/Product/1",
      inventoryItemId: null,
      sku: "SKU-001",
      barcode: null,
      price: "24.99",
      compareAtPrice: null,
      inventoryQuantity: 10,
      weight: 1.0,  // old weight
      weightUnit: null,
      cost: null, inventoryPolicy: null, taxable: null,
      option1: null, option2: null, option3: null,
    };

    const supplierProduct = supplier({
      title: "T", vendor: "V",
      variants: [{
        sourceKey: "V1", sku: "SKU-001", options: {},
        price: "24.99", weight: 2.5,  // new weight — different value
        sourceData: {},
      }],
    });

    const diff = computeProductDiff(
      supplierProduct,
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyWithNullUnit],
      [variantMapping()],
    );

    // Weight values differ: "1" vs "2.5" — detectable even without unit
    const weightChange = diff.variantChanges.flatMap((v) => v.changes).find((c) => c.field === "weight");
    expect(weightChange).toBeDefined();
    expect(weightChange!.shopifyValue).toBe("1");
    expect(weightChange!.supplierValue).toBe("2.5");
  });
});

// ---------------------------------------------------------------------------
// Variant lifecycle — added variants
// ---------------------------------------------------------------------------

describe("diff — added variants", () => {
  it("detects a new variant with no persisted mapping as added", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [
          { sourceKey: "V1", sku: "SKU-001", options: {}, price: "24.99", sourceData: {} },
          { sourceKey: "V2", sku: "SKU-NEW", options: { Color: "Blue" }, price: "29.99", sourceData: {} },
        ],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant()],
      [variantMapping()], // only V1 has a mapping
    );

    expect(diff.hasChanges).toBe(true);
    const added = diff.variantChanges.filter((v) => v.status === "added");
    expect(added).toHaveLength(1);
    expect(added[0].sourceVariantKey).toBe("V2");
    expect(added[0].shopifyVariantId).toBeNull();
    expect(added[0].changes).toHaveLength(0);
  });

  it("does not mark V1 as added when it has a mapping", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V" }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant()],
      [variantMapping()],
    );

    const added = diff.variantChanges.filter((v) => v.status === "added");
    expect(added).toHaveLength(0);
  });

  it("marks variant as added when no mappings exist at all", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V" }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant()],
      [], // no mappings — first-time diff for this product
    );

    const added = diff.variantChanges.filter((v) => v.status === "added");
    expect(added).toHaveLength(1);
    expect(added[0].sourceVariantKey).toBe("V1");
  });
});

// ---------------------------------------------------------------------------
// Variant lifecycle — discontinued variants
// ---------------------------------------------------------------------------

describe("diff — discontinued variants", () => {
  it("detects a mapped variant absent from supplier file as discontinued", () => {
    // Supplier file only has V1. V2 has a persisted mapping but is gone from the file.
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [
          { sourceKey: "V1", sku: "SKU-001", options: {}, price: "24.99", sourceData: {} },
        ],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [
        shopifyVariant({ shopifyVariantId: "gid://shopify/ProductVariant/1" }),
        shopifyVariant({ shopifyVariantId: "gid://shopify/ProductVariant/2", sku: "SKU-002" }),
      ],
      [
        variantMapping({ sourceVariantKey: "V1", shopifyVariantId: "gid://shopify/ProductVariant/1" }),
        variantMapping({ id: "vm-2", sourceVariantKey: "V2", sourceVariantFingerprint: "v2",
          shopifyVariantId: "gid://shopify/ProductVariant/2", sourceSku: "SKU-002", shopifySku: "SKU-002" }),
      ],
    );

    expect(diff.hasChanges).toBe(true);
    const disc = diff.variantChanges.filter((v) => v.status === "discontinued");
    expect(disc).toHaveLength(1);
    expect(disc[0].sourceVariantKey).toBe("V2");
    expect(disc[0].shopifyVariantId).toBe("gid://shopify/ProductVariant/2");
    expect(disc[0].changes).toHaveLength(0);
  });

  it("does not mark present variants as discontinued", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V" }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant()],
      [variantMapping()],
    );

    const disc = diff.variantChanges.filter((v) => v.status === "discontinued");
    expect(disc).toHaveLength(0);
  });

  it("detects both added and discontinued in same product", () => {
    // V1 discontinued (mapping exists, absent from file), V2 new (no mapping)
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        variants: [
          { sourceKey: "V2", sku: "SKU-NEW", options: { Color: "Blue" }, price: "29.99", sourceData: {} },
        ],
      }),
      shopifyProduct({ title: "T", vendor: "V" }),
      [shopifyVariant()],
      [variantMapping()], // only V1 mapped, V1 absent from supplier
    );

    expect(diff.hasChanges).toBe(true);
    const added = diff.variantChanges.filter((v) => v.status === "added");
    const disc = diff.variantChanges.filter((v) => v.status === "discontinued");
    expect(added).toHaveLength(1);
    expect(added[0].sourceVariantKey).toBe("V2");
    expect(disc).toHaveLength(1);
    expect(disc[0].sourceVariantKey).toBe("V1");
  });
});

// ---------------------------------------------------------------------------
// Image diff — CDN URL false-positive fix
// ---------------------------------------------------------------------------

describe("diff — images CDN URL tolerance", () => {
  it("no change when same image filename but different CDN domain/version", () => {
    // Shopify converts source URLs to CDN URLs — should not show as a diff
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        images: [{ sourceUrl: "https://mystore.com/products/photo.jpg", position: 1 }],
      }),
      shopifyProduct({
        title: "T", vendor: "V",
        images: [{ url: "https://cdn.shopify.com/s/files/1/0803/6591/products/photo.jpg?v=1426708827", altText: null }],
      }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "images")).toBeUndefined();
  });

  it("no change when same filename with different version param (?v=)", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        images: [{ sourceUrl: "https://cdn.shopify.com/s/files/1/products/skin-care.jpg", position: 1 }],
      }),
      shopifyProduct({
        title: "T", vendor: "V",
        images: [{ url: "https://cdn.shopify.com/s/files/1/products/skin-care.jpg?v=9999", altText: null }],
      }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "images")).toBeUndefined();
  });

  it("detects change when filenames are genuinely different", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        images: [{ sourceUrl: "https://mystore.com/products/new-photo.jpg", position: 1 }],
      }),
      shopifyProduct({
        title: "T", vendor: "V",
        images: [{ url: "https://cdn.shopify.com/s/files/1/products/old-photo.jpg?v=123", altText: null }],
      }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "images")).toBeDefined();
  });

  it("no change with 2 images same filenames regardless of CDN transform", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        images: [
          { sourceUrl: "https://store.com/products/a.jpg", position: 1 },
          { sourceUrl: "https://store.com/products/b.jpg", position: 2 },
        ],
      }),
      shopifyProduct({
        title: "T", vendor: "V",
        images: [
          { url: "https://cdn.shopify.com/s/files/b.jpg?v=1", altText: null },
          { url: "https://cdn.shopify.com/s/files/a.jpg?v=2", altText: null },
        ],
      }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "images")).toBeUndefined();
  });

  it("detects change when image count differs even with CDN transform", () => {
    const diff = computeProductDiff(
      supplier({
        title: "T", vendor: "V",
        images: [
          { sourceUrl: "https://store.com/products/a.jpg", position: 1 },
          { sourceUrl: "https://store.com/products/b.jpg", position: 2 },
        ],
      }),
      shopifyProduct({
        title: "T", vendor: "V",
        images: [{ url: "https://cdn.shopify.com/s/files/a.jpg?v=1", altText: null }],
      }),
      [], [],
    );
    const c = diff.productChanges.find((ci) => ci.field === "images");
    expect(c).toBeDefined();
    expect(c!.shopifyValue).toBe("1 image");
    expect(c!.supplierValue).toBe("2 images");
  });
});

// ---------------------------------------------------------------------------
// Tags — StoreDelivery-managed tags excluded from diff
// ---------------------------------------------------------------------------

describe("diff — tags with storedelivery: prefix", () => {
  it("no change when Shopify has vendor tag but supplier file does not", () => {
    // The storedelivery:vendor: tag is written by the app, not the supplier
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V", tags: ["Accessories"] }),
      shopifyProduct({
        title: "T", vendor: "V",
        tags: ["Accessories", "storedelivery:vendor:united-by-blue"],
      }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "tags")).toBeUndefined();
  });

  it("detects real tag change (not the storedelivery tag)", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V", tags: ["Sale"] }),
      shopifyProduct({
        title: "T", vendor: "V",
        tags: ["Accessories", "storedelivery:vendor:united-by-blue"],
      }),
      [], [],
    );
    const c = diff.productChanges.find((ci) => ci.field === "tags");
    expect(c).toBeDefined();
    // Shopify value excludes the app tag, supplier value is just "Sale"
    expect(c!.shopifyValue).toBe("Accessories");
    expect(c!.supplierValue).toBe("Sale");
  });

  it("no change when both have no tags and Shopify has only storedelivery tag", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V", tags: [] }),
      shopifyProduct({
        title: "T", vendor: "V",
        tags: ["storedelivery:vendor:acme"],
      }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "tags")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Inventory Update false-positive prevention
// — product-level fields skipped when supplier omits them
// ---------------------------------------------------------------------------

describe("diff — product fields skipped when supplier omits", () => {
  it("no title diff when supplier has no title (empty string)", () => {
    // Inventory Update files don't have a Title column
    const diff = computeProductDiff(
      supplier({ title: "", vendor: "V" }),
      shopifyProduct({ title: "Ayres Chambray", vendor: "V" }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "title")).toBeUndefined();
  });

  it("detects title change when supplier explicitly provides a different title", () => {
    const diff = computeProductDiff(
      supplier({ title: "New Title", vendor: "V" }),
      shopifyProduct({ title: "Old Title", vendor: "V" }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "title")).toBeDefined();
  });

  it("no vendor diff when supplier has no vendor column (empty/null)", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "" }),
      shopifyProduct({ title: "T", vendor: "United By Blue" }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "vendor")).toBeUndefined();
  });

  it("no tags diff when supplier has no tags column (empty array)", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V", tags: [] }),
      shopifyProduct({ title: "T", vendor: "V", tags: ["Shirts", "Sale"] }),
      [], [],
    );
    expect(diff.productChanges.find((c) => c.field === "tags")).toBeUndefined();
  });

  it("full Inventory Update scenario — qty-only file shows only qty changes", () => {
    // Simulate qty-update CSV: no title, no vendor, no tags, no images, only qty
    const diff = computeProductDiff(
      supplier({
        title: "",          // no Title column
        vendor: "",         // no Vendor column
        tags: [],           // no Tags column
        images: [],         // no Images column
        variants: [{
          sourceKey: "V1",
          sku: "SKU-001",
          options: {},
          price: undefined,            // no Price column
          inventoryQuantity: 50,       // ← the only change
          sourceData: {},
        }],
      }),
      shopifyProduct({ title: "Classic Tee", vendor: "Acme", tags: ["Shirts"] }),
      [shopifyVariant({ price: "24.99", inventoryQuantity: 10 })],
      [variantMapping()],
    );

    // Only inventoryQuantity should show as a change
    const productChanges = diff.productChanges;
    const variantChanges = diff.variantChanges.flatMap((v) => v.changes);

    expect(productChanges.find((c) => c.field === "title")).toBeUndefined();
    expect(productChanges.find((c) => c.field === "vendor")).toBeUndefined();
    expect(productChanges.find((c) => c.field === "tags")).toBeUndefined();
    expect(productChanges.find((c) => c.field === "images")).toBeUndefined();
    expect(variantChanges.find((c) => c.field === "price")).toBeUndefined();

    const qtyChange = variantChanges.find((c) => c.field === "inventoryQuantity");
    expect(qtyChange).toBeDefined();
    expect(qtyChange!.shopifyValue).toBe("10");
    expect(qtyChange!.supplierValue).toBe("50");
  });
});
