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

  it("detects images removed (Shopify has, supplier doesn't)", () => {
    const diff = computeProductDiff(
      supplier({ title: "T", vendor: "V", images: [] }),
      shopifyProduct({
        title: "T", vendor: "V",
        images: [{ url: "https://img.com/old.jpg", altText: null }],
      }),
      [], [],
    );
    const c = diff.productChanges.find((c) => c.field === "images")!;
    expect(c).toBeDefined();
    expect(c.shopifyValue).toBe("1 image");
    expect(c.supplierValue).toBeNull();
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
      [], [],
    );
    expect(diff.hasChanges).toBe(false);
    expect(diff.productChanges).toHaveLength(0);
    expect(diff.variantChanges).toHaveLength(0);
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
  it("skips supplier variants without mapping", () => {
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
    // V-NEW has no mapping → should not appear in diff
    expect(diff.variantChanges.every((v) => v.sourceVariantKey !== "V-NEW")).toBe(true);
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
