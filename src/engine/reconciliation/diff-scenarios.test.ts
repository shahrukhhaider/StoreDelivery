/**
 * End-to-end diff scenario tests.
 *
 * These test the full classification + diff pipeline:
 *   classifyProducts → computeProductDiff → final classification
 *
 * Simulates what the reconciliation service does with live Shopify data.
 */

import { describe, it, expect } from "vitest";
import { classifyProducts } from "./reconciliation-engine.js";
import { computeProductDiff } from "./diff-engine.js";
import type { CatalogProduct } from "@shared/types/catalog.js";
import type {
  PersistedProductMapping,
  ShopifyIdentityIndex,
  SnapshotProduct,
  SnapshotVariant,
  PersistedVariantMapping,
  ProductClassification,
  ProductDiff,
} from "@shared/types/reconciliation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    sourceKey: "classic-tee",
    title: "Classic Tee",
    vendor: "BrandCo",
    tags: ["sale"],
    variants: [
      { sourceKey: "V1", sku: "TEE-RED-S", barcode: "111", options: { Color: "Red" }, price: "24.99", inventoryQuantity: 10, sourceData: {} },
    ],
    images: [{ sourceUrl: "https://img.com/tee.jpg", position: 1 }],
    sourceData: {},
    ...overrides,
  };
}

function makeShopifyProduct(overrides: Partial<SnapshotProduct> = {}): SnapshotProduct {
  return {
    shopifyProductId: "gid://shopify/Product/1",
    title: "Classic Tee",
    description: null,
    handle: "classic-tee",
    vendor: "BrandCo",
    productType: null,
    status: "active",
    tags: ["sale"],
    images: [{ url: "https://img.com/tee.jpg", altText: null }],
    ...overrides,
  };
}

function makeShopifyVariant(overrides: Partial<SnapshotVariant> = {}): SnapshotVariant {
  return {
    shopifyVariantId: "gid://shopify/ProductVariant/1",
    shopifyProductId: "gid://shopify/Product/1",
    sku: "TEE-RED-S",
    barcode: "111",
    price: "24.99",
    compareAtPrice: null,
    inventoryQuantity: 10,
    weight: null,
    weightUnit: null,
    option1: "Red",
    option2: null,
    option3: null,
    ...overrides,
  };
}

function makeMapping(sourceKey: string, shopifyProductId: string): PersistedProductMapping {
  return {
    id: `pm-${sourceKey}`,
    sourceProductKey: sourceKey,
    sourceProductFingerprint: sourceKey.toLowerCase(),
    shopifyProductId,
    mappingStatus: "MAPPED",
    variants: [{
      id: "vm-1",
      sourceVariantKey: "V1",
      sourceVariantFingerprint: "v1",
      shopifyVariantId: "gid://shopify/ProductVariant/1",
      sourceSku: "TEE-RED-S",
      barcode: "111",
      shopifySku: "TEE-RED-S",
      skuSource: "SUPPLIER",
    }],
  };
}

function emptyIndex(): ShopifyIdentityIndex {
  return { skus: new Map(), barcodes: new Map(), titles: new Map() };
}

/**
 * Simulate the reconciliation service's diff flow:
 * classify → for EXISTING_MAPPED, compute diff → reclassify
 */
function runReconciliationWithDiff(
  products: CatalogProduct[],
  mappings: Map<string, PersistedProductMapping>,
  shopifyIndex: ShopifyIdentityIndex,
  shopifyDetails: Map<string, { product: SnapshotProduct; variants: SnapshotVariant[] }>,
): { classifications: ProductClassification[]; diffs: ProductDiff[] } {
  const { classifications } = classifyProducts({ products, existingMappings: mappings, shopifyIndex });
  const diffs: ProductDiff[] = [];

  const productByKey = new Map(products.map((p) => [p.sourceKey, p]));

  const finalClassifications = classifications.map((c) => {
    if (c.classification !== "EXISTING_MAPPED" || !c.matchedShopifyProductId) return c;

    const detail = shopifyDetails.get(c.matchedShopifyProductId);
    const supplierProduct = productByKey.get(c.sourceProductKey);
    if (!detail || !supplierProduct) {
      return { ...c, classification: "NO_CHANGE" as const, proposedAction: "NO_CHANGE" as const };
    }

    const mapping = mappings.get(c.sourceProductKey);
    const diff = computeProductDiff(supplierProduct, detail.product, detail.variants, mapping?.variants ?? []);

    if (diff.hasChanges) {
      diffs.push(diff);
      return { ...c, classification: "UPDATE_REVIEW" as const, proposedAction: "UPDATE_PRODUCT" as const };
    }
    return { ...c, classification: "NO_CHANGE" as const, proposedAction: "NO_CHANGE" as const };
  });

  return { classifications: finalClassifications, diffs };
}

// ---------------------------------------------------------------------------
// Scenario 1: Re-upload same file, nothing changed
// ---------------------------------------------------------------------------

describe("Scenario: re-upload identical file", () => {
  it("all products classified as NO_CHANGE, zero diffs", () => {
    const product = makeProduct();
    const mappings = new Map([["classic-tee", makeMapping("classic-tee", "gid://shopify/Product/1")]]);
    const details = new Map([["gid://shopify/Product/1", {
      product: makeShopifyProduct(),
      variants: [makeShopifyVariant()],
    }]]);

    const { classifications, diffs } = runReconciliationWithDiff(
      [product], mappings, emptyIndex(), details,
    );

    expect(classifications[0].classification).toBe("NO_CHANGE");
    expect(diffs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Supplier updated prices
// ---------------------------------------------------------------------------

describe("Scenario: price update", () => {
  it("detects price increase → UPDATE_REVIEW", () => {
    const product = makeProduct({
      variants: [{ sourceKey: "V1", sku: "TEE-RED-S", barcode: "111", options: { Color: "Red" }, price: "34.99", inventoryQuantity: 10, sourceData: {} }],
    });
    const mappings = new Map([["classic-tee", makeMapping("classic-tee", "gid://shopify/Product/1")]]);
    const details = new Map([["gid://shopify/Product/1", {
      product: makeShopifyProduct(),
      variants: [makeShopifyVariant({ price: "24.99" })],
    }]]);

    const { classifications, diffs } = runReconciliationWithDiff(
      [product], mappings, emptyIndex(), details,
    );

    expect(classifications[0].classification).toBe("UPDATE_REVIEW");
    expect(classifications[0].proposedAction).toBe("UPDATE_PRODUCT");
    expect(diffs).toHaveLength(1);
    const priceChange = diffs[0].variantChanges[0].changes.find((c) => c.field === "price")!;
    expect(priceChange.shopifyValue).toBe("24.99");
    expect(priceChange.supplierValue).toBe("34.99");
  });

  it("detects price decrease → UPDATE_REVIEW", () => {
    const product = makeProduct({
      variants: [{ sourceKey: "V1", sku: "TEE-RED-S", barcode: "111", options: { Color: "Red" }, price: "14.99", inventoryQuantity: 10, sourceData: {} }],
    });
    const mappings = new Map([["classic-tee", makeMapping("classic-tee", "gid://shopify/Product/1")]]);
    const details = new Map([["gid://shopify/Product/1", {
      product: makeShopifyProduct(),
      variants: [makeShopifyVariant({ price: "24.99" })],
    }]]);

    const { classifications, diffs } = runReconciliationWithDiff(
      [product], mappings, emptyIndex(), details,
    );

    expect(classifications[0].classification).toBe("UPDATE_REVIEW");
    const priceChange = diffs[0].variantChanges[0].changes.find((c) => c.field === "price")!;
    expect(priceChange.shopifyValue).toBe("24.99");
    expect(priceChange.supplierValue).toBe("14.99");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Supplier updated title/vendor
// ---------------------------------------------------------------------------

describe("Scenario: title and vendor update", () => {
  it("detects title change → UPDATE_REVIEW with product-level diff", () => {
    const product = makeProduct({ title: "Classic Tee V2" });
    const mappings = new Map([["classic-tee", makeMapping("classic-tee", "gid://shopify/Product/1")]]);
    const details = new Map([["gid://shopify/Product/1", {
      product: makeShopifyProduct({ title: "Classic Tee" }),
      variants: [makeShopifyVariant()],
    }]]);

    const { classifications, diffs } = runReconciliationWithDiff(
      [product], mappings, emptyIndex(), details,
    );

    expect(classifications[0].classification).toBe("UPDATE_REVIEW");
    expect(diffs[0].productChanges.find((c) => c.field === "title")).toBeDefined();
  });

  it("detects vendor change", () => {
    const product = makeProduct({ vendor: "NewBrand" });
    const mappings = new Map([["classic-tee", makeMapping("classic-tee", "gid://shopify/Product/1")]]);
    const details = new Map([["gid://shopify/Product/1", {
      product: makeShopifyProduct({ vendor: "OldBrand" }),
      variants: [makeShopifyVariant()],
    }]]);

    const { diffs } = runReconciliationWithDiff(
      [product], mappings, emptyIndex(), details,
    );

    expect(diffs[0].productChanges.find((c) => c.field === "vendor")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Supplier added images
// ---------------------------------------------------------------------------

describe("Scenario: image update", () => {
  it("detects new images added → UPDATE_REVIEW", () => {
    const product = makeProduct({
      images: [
        { sourceUrl: "https://img.com/tee.jpg", position: 1 },
        { sourceUrl: "https://img.com/tee-back.jpg", position: 2 },
      ],
    });
    const mappings = new Map([["classic-tee", makeMapping("classic-tee", "gid://shopify/Product/1")]]);
    const details = new Map([["gid://shopify/Product/1", {
      product: makeShopifyProduct({
        images: [{ url: "https://img.com/tee.jpg", altText: null }],
      }),
      variants: [makeShopifyVariant()],
    }]]);

    const { classifications, diffs } = runReconciliationWithDiff(
      [product], mappings, emptyIndex(), details,
    );

    expect(classifications[0].classification).toBe("UPDATE_REVIEW");
    const imageChange = diffs[0].productChanges.find((c) => c.field === "images")!;
    expect(imageChange).toBeDefined();
    expect(imageChange.shopifyValue).toBe("1 image");
    expect(imageChange.supplierValue).toBe("2 images");
  });

  it("detects image URL changed", () => {
    const product = makeProduct({
      images: [{ sourceUrl: "https://img.com/new-photo.jpg", position: 1 }],
    });
    const mappings = new Map([["classic-tee", makeMapping("classic-tee", "gid://shopify/Product/1")]]);
    const details = new Map([["gid://shopify/Product/1", {
      product: makeShopifyProduct({
        images: [{ url: "https://img.com/old-photo.jpg", altText: null }],
      }),
      variants: [makeShopifyVariant()],
    }]]);

    const { diffs } = runReconciliationWithDiff(
      [product], mappings, emptyIndex(), details,
    );

    expect(diffs[0].productChanges.find((c) => c.field === "images")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: Inventory quantity changed
// ---------------------------------------------------------------------------

describe("Scenario: inventory update", () => {
  it("detects inventory increase → UPDATE_REVIEW", () => {
    const product = makeProduct({
      variants: [{ sourceKey: "V1", sku: "TEE-RED-S", barcode: "111", options: { Color: "Red" }, price: "24.99", inventoryQuantity: 50, sourceData: {} }],
    });
    const mappings = new Map([["classic-tee", makeMapping("classic-tee", "gid://shopify/Product/1")]]);
    const details = new Map([["gid://shopify/Product/1", {
      product: makeShopifyProduct(),
      variants: [makeShopifyVariant({ inventoryQuantity: 10 })],
    }]]);

    const { classifications, diffs } = runReconciliationWithDiff(
      [product], mappings, emptyIndex(), details,
    );

    expect(classifications[0].classification).toBe("UPDATE_REVIEW");
    const qtyChange = diffs[0].variantChanges[0].changes.find((c) => c.field === "inventoryQuantity")!;
    expect(qtyChange.shopifyValue).toBe("10");
    expect(qtyChange.supplierValue).toBe("50");
  });

  it("detects inventory decrease to zero (out of stock)", () => {
    const product = makeProduct({
      variants: [{ sourceKey: "V1", sku: "TEE-RED-S", barcode: "111", options: { Color: "Red" }, price: "24.99", inventoryQuantity: 0, sourceData: {} }],
    });
    const mappings = new Map([["classic-tee", makeMapping("classic-tee", "gid://shopify/Product/1")]]);
    const details = new Map([["gid://shopify/Product/1", {
      product: makeShopifyProduct(),
      variants: [makeShopifyVariant({ inventoryQuantity: 25 })],
    }]]);

    const { diffs } = runReconciliationWithDiff(
      [product], mappings, emptyIndex(), details,
    );

    const qtyChange = diffs[0].variantChanges[0].changes.find((c) => c.field === "inventoryQuantity")!;
    expect(qtyChange.shopifyValue).toBe("25");
    expect(qtyChange.supplierValue).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Mixed — some changed, some not
// ---------------------------------------------------------------------------

describe("Scenario: mixed changes", () => {
  it("some products NO_CHANGE, some UPDATE_REVIEW", () => {
    const products = [
      makeProduct({ sourceKey: "tee-unchanged" }),
      makeProduct({ sourceKey: "tee-changed", title: "Updated Tee" }),
    ];
    const mappings = new Map([
      ["tee-unchanged", { ...makeMapping("tee-unchanged", "gid://shopify/Product/1"), id: "pm-1" }],
      ["tee-changed", { ...makeMapping("tee-changed", "gid://shopify/Product/2"), id: "pm-2" }],
    ]);
    const details = new Map([
      ["gid://shopify/Product/1", { product: makeShopifyProduct(), variants: [makeShopifyVariant()] }],
      ["gid://shopify/Product/2", { product: makeShopifyProduct({ shopifyProductId: "gid://shopify/Product/2", title: "Old Tee" }), variants: [makeShopifyVariant({ shopifyProductId: "gid://shopify/Product/2" })] }],
    ]);

    const { classifications, diffs } = runReconciliationWithDiff(
      products, mappings, emptyIndex(), details,
    );

    const unchanged = classifications.find((c) => c.sourceProductKey === "tee-unchanged")!;
    const changed = classifications.find((c) => c.sourceProductKey === "tee-changed")!;

    expect(unchanged.classification).toBe("NO_CHANGE");
    expect(changed.classification).toBe("UPDATE_REVIEW");
    expect(diffs).toHaveLength(1);
    expect(diffs[0].sourceProductKey).toBe("tee-changed");
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: New products + existing with changes coexist
// ---------------------------------------------------------------------------

describe("Scenario: new + existing with changes", () => {
  it("NEW_PRODUCT and UPDATE_REVIEW coexist in same batch", () => {
    const products = [
      makeProduct({ sourceKey: "existing-tee", title: "Updated Tee" }),
      makeProduct({ sourceKey: "brand-new-product", title: "New Product", variants: [{ sourceKey: "VN", sku: "NEW-SKU", options: {}, price: "49.99", sourceData: {} }] }),
    ];
    const mappings = new Map([
      ["existing-tee", makeMapping("existing-tee", "gid://shopify/Product/1")],
      // brand-new-product has no mapping
    ]);
    const details = new Map([
      ["gid://shopify/Product/1", { product: makeShopifyProduct({ title: "Old Tee" }), variants: [makeShopifyVariant()] }],
    ]);

    const { classifications, diffs } = runReconciliationWithDiff(
      products, mappings, emptyIndex(), details,
    );

    const existing = classifications.find((c) => c.sourceProductKey === "existing-tee")!;
    const newProd = classifications.find((c) => c.sourceProductKey === "brand-new-product")!;

    expect(existing.classification).toBe("UPDATE_REVIEW");
    expect(newProd.classification).toBe("NEW_PRODUCT");
    expect(diffs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: Detail fetch fails → safe fallback to NO_CHANGE
// ---------------------------------------------------------------------------

describe("Scenario: Shopify detail fetch fails", () => {
  it("falls back to NO_CHANGE when product details unavailable", () => {
    const product = makeProduct({ title: "Changed Title" });
    const mappings = new Map([["classic-tee", makeMapping("classic-tee", "gid://shopify/Product/1")]]);
    // Empty details map — simulates fetch failure
    const details = new Map<string, { product: SnapshotProduct; variants: SnapshotVariant[] }>();

    const { classifications, diffs } = runReconciliationWithDiff(
      [product], mappings, emptyIndex(), details,
    );

    // Can't diff without details → safe fallback
    expect(classifications[0].classification).toBe("NO_CHANGE");
    expect(diffs).toHaveLength(0);
  });
});
