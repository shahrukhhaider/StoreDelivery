import { describe, it, expect } from "vitest";
import { applyOverrides, computeDiff, _parsePath, _setNestedValue, type Override } from "./merge.js";
import type { CatalogProduct } from "@shared/types/catalog.js";

function baseProduct(): CatalogProduct {
  return {
    sourceKey: "TEST-001",
    title: "Widget",
    description: "A widget",
    vendor: "Acme",
    productType: "Gadgets",
    tags: ["tag1", "tag2"],
    variants: [
      {
        sourceKey: "V1",
        sku: "W-001",
        barcode: "1234567890",
        options: { Color: "Red" },
        price: "24.99",
        compareAtPrice: "29.99",
        cost: "12.00",
        inventoryQuantity: 50,
        weight: 1.5,
        weightUnit: "lb",
        sourceData: {},
      },
    ],
    images: [{ sourceUrl: "https://img.com/w.jpg", position: 1 }],
    sourceData: {},
  };
}

describe("parsePath", () => {
  it("parses simple field", () => {
    expect(_parsePath("title")).toEqual(["title"]);
  });

  it("parses nested field", () => {
    expect(_parsePath("variants[0].price")).toEqual(["variants", 0, "price"]);
  });

  it("parses deeply nested", () => {
    expect(_parsePath("variants[2].options.Color")).toEqual([
      "variants", 2, "options", "Color",
    ]);
  });
});

describe("applyOverrides", () => {
  it("returns original when no overrides", () => {
    const product = baseProduct();
    const result = applyOverrides(product, []);
    expect(result).toEqual(product);
  });

  it("does not mutate the original product", () => {
    const product = baseProduct();
    const originalTitle = product.title;
    applyOverrides(product, [
      { field: "title", oldValue: "Widget", newValue: "Updated Widget", source: "user" },
    ]);
    expect(product.title).toBe(originalTitle);
  });

  it("applies a single top-level override", () => {
    const product = baseProduct();
    const result = applyOverrides(product, [
      { field: "title", oldValue: "Widget", newValue: "Super Widget", source: "user" },
    ]);
    expect(result.title).toBe("Super Widget");
    expect(result.vendor).toBe("Acme"); // unchanged
  });

  it("applies multiple overrides", () => {
    const product = baseProduct();
    const result = applyOverrides(product, [
      { field: "title", oldValue: "Widget", newValue: "New Title", source: "user" },
      { field: "vendor", oldValue: "Acme", newValue: "BrandX", source: "user" },
    ]);
    expect(result.title).toBe("New Title");
    expect(result.vendor).toBe("BrandX");
  });

  it("applies variant-level override", () => {
    const product = baseProduct();
    const result = applyOverrides(product, [
      { field: "variants[0].price", oldValue: "24.99", newValue: "19.99", source: "user" },
    ]);
    expect(result.variants[0].price).toBe("19.99");
    expect(result.variants[0].sku).toBe("W-001"); // unchanged
  });

  it("applies variant SKU override", () => {
    const product = baseProduct();
    const result = applyOverrides(product, [
      { field: "variants[0].sku", oldValue: "W-001", newValue: "W-002", source: "bulk_rule" },
    ]);
    expect(result.variants[0].sku).toBe("W-002");
  });

  it("applies tags override", () => {
    const product = baseProduct();
    const result = applyOverrides(product, [
      { field: "tags", oldValue: ["tag1", "tag2"], newValue: ["new-tag"], source: "auto_fix" },
    ]);
    expect(result.tags).toEqual(["new-tag"]);
  });

  it("handles override to null/undefined", () => {
    const product = baseProduct();
    const result = applyOverrides(product, [
      { field: "description", oldValue: "A widget", newValue: null, source: "user" },
    ]);
    expect(result.description).toBeNull();
  });

  it("handles auto_fix source", () => {
    const product = baseProduct();
    const result = applyOverrides(product, [
      { field: "title", oldValue: "Widget", newValue: "Widget (fixed)", source: "auto_fix" },
    ]);
    expect(result.title).toBe("Widget (fixed)");
  });
});

describe("computeDiff", () => {
  it("returns empty diff for identical products", () => {
    const product = baseProduct();
    const diff = computeDiff(product, product);
    expect(diff).toHaveLength(0);
  });

  it("detects title change", () => {
    const original = baseProduct();
    const resolved = { ...baseProduct(), title: "New Title" };
    const diff = computeDiff(original, resolved);
    expect(diff).toContainEqual({
      field: "title",
      oldValue: "Widget",
      newValue: "New Title",
    });
  });

  it("detects variant price change", () => {
    const original = baseProduct();
    const resolved = JSON.parse(JSON.stringify(baseProduct())) as CatalogProduct;
    resolved.variants[0].price = "19.99";
    const diff = computeDiff(original, resolved);
    expect(diff).toContainEqual({
      field: "variants[0].price",
      oldValue: "24.99",
      newValue: "19.99",
    });
  });

  it("detects multiple changes", () => {
    const original = baseProduct();
    const resolved = JSON.parse(JSON.stringify(baseProduct())) as CatalogProduct;
    resolved.title = "New";
    resolved.vendor = "NewVendor";
    resolved.variants[0].sku = "NEW-SKU";
    const diff = computeDiff(original, resolved);
    expect(diff.length).toBeGreaterThanOrEqual(3);
  });

  it("detects tags change", () => {
    const original = baseProduct();
    const resolved = { ...baseProduct(), tags: ["new-tag"] };
    const diff = computeDiff(original, resolved);
    expect(diff).toContainEqual({
      field: "tags",
      oldValue: ["tag1", "tag2"],
      newValue: ["new-tag"],
    });
  });
});
