/**
 * Shopify Writer tests — validates the productSet mutation input builder.
 *
 * These test the pure function that converts CatalogProduct → Shopify API input,
 * catching schema mismatches before they hit the live API.
 */

import { describe, it, expect } from "vitest";
import { _buildProductSetInput, _buildProductOptions } from "./writer.js";
import type { CatalogProduct } from "@shared/types/catalog.js";

function makeProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    sourceKey: "TEST-001",
    title: "Test Widget",
    description: "A test widget",
    vendor: "TestBrand",
    productType: "Widgets",
    tags: ["tag1", "tag2"],
    variants: [{
      sourceKey: "V1",
      sku: "SKU-001",
      barcode: "1234567890",
      options: {},
      price: "24.99",
      compareAtPrice: "29.99",
      sourceData: {},
    }],
    images: [{ sourceUrl: "https://img.com/widget.jpg", position: 1 }],
    sourceData: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildProductSetInput — basic structure
// ---------------------------------------------------------------------------

describe("buildProductSetInput", () => {
  it("produces valid productSet with title, vendor, type, tags", () => {
    const { productSet } = _buildProductSetInput(makeProduct(), null);
    expect(productSet.title).toBe("Test Widget");
    expect(productSet.descriptionHtml).toBe("A test widget");
    expect(productSet.vendor).toBe("TestBrand");
    expect(productSet.productType).toBe("Widgets");
    expect(productSet.tags).toEqual(["tag1", "tag2"]);
  });

  it("uses 'Untitled Product' when title is empty", () => {
    const { productSet } = _buildProductSetInput(makeProduct({ title: "" }), null);
    expect(productSet.title).toBe("Untitled Product");
  });

  it("omits description when not provided", () => {
    const { productSet } = _buildProductSetInput(makeProduct({ description: undefined }), null);
    expect(productSet.descriptionHtml).toBeUndefined();
  });

  it("omits tags when empty", () => {
    const { productSet } = _buildProductSetInput(makeProduct({ tags: [] }), null);
    expect(productSet.tags).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Variant structure
// ---------------------------------------------------------------------------

describe("variant format", () => {
  it("includes sku, barcode, price, compareAtPrice", () => {
    const { productSet } = _buildProductSetInput(makeProduct(), null);
    const variants = productSet.variants as Array<Record<string, unknown>>;
    expect(variants).toHaveLength(1);
    expect(variants[0].sku).toBe("SKU-001");
    expect(variants[0].barcode).toBe("1234567890");
    expect(variants[0].price).toBe("24.99");
    expect(variants[0].compareAtPrice).toBe("29.99");
  });

  it("does NOT include weight or weightUnit on variant (not in ProductVariantSetInput)", () => {
    const product = makeProduct({
      variants: [{
        sourceKey: "V1",
        sku: "A",
        options: {},
        price: "10",
        weight: 2.5,
        weightUnit: "lb",
        sourceData: {},
      }],
    });
    const { productSet } = _buildProductSetInput(product, null);
    const variants = productSet.variants as Array<Record<string, unknown>>;
    expect(variants[0]).not.toHaveProperty("weight");
    expect(variants[0]).not.toHaveProperty("weightUnit");
  });

  it("omits optional fields when not present", () => {
    const product = makeProduct({
      variants: [{
        sourceKey: "V1",
        options: {},
        price: "10",
        sourceData: {},
      }],
    });
    const { productSet } = _buildProductSetInput(product, null);
    const variants = productSet.variants as Array<Record<string, unknown>>;
    expect(variants[0].sku).toBeUndefined();
    expect(variants[0].barcode).toBeUndefined();
    expect(variants[0].compareAtPrice).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// optionValues format — must use {optionName, name} not {name, value}
// ---------------------------------------------------------------------------

describe("optionValues format", () => {
  it("uses optionName + name fields (not name + value)", () => {
    const product = makeProduct({
      variants: [{
        sourceKey: "V1",
        sku: "A",
        options: { Color: "Red" },
        price: "10",
        sourceData: {},
      }],
    });
    const { productSet } = _buildProductSetInput(product, null);
    const variants = productSet.variants as Array<Record<string, unknown>>;
    const optionValues = variants[0].optionValues as Array<Record<string, string>>;

    expect(optionValues[0]).toHaveProperty("optionName", "Color");
    expect(optionValues[0]).toHaveProperty("name", "Red");
    expect(optionValues[0]).not.toHaveProperty("value");
  });

  it("provides default Title option for single variant with no options", () => {
    const product = makeProduct({
      variants: [{
        sourceKey: "V1",
        sku: "A",
        options: {},
        price: "10",
        sourceData: {},
      }],
    });
    const { productSet } = _buildProductSetInput(product, null);
    const variants = productSet.variants as Array<Record<string, unknown>>;
    const optionValues = variants[0].optionValues as Array<Record<string, string>>;

    expect(optionValues).toHaveLength(1);
    expect(optionValues[0].optionName).toBe("Title");
    expect(optionValues[0].name).toBe("Default Title");
  });

  it("provides unique defaults for multiple variants without options", () => {
    const product = makeProduct({
      variants: [
        { sourceKey: "V1", sku: "A", options: {}, price: "10", sourceData: {} },
        { sourceKey: "V2", sku: "B", options: {}, price: "20", sourceData: {} },
        { sourceKey: "V3", sku: "C", options: {}, price: "30", sourceData: {} },
      ],
    });
    const { productSet } = _buildProductSetInput(product, null);
    const variants = productSet.variants as Array<Record<string, unknown>>;

    const names = variants.map((v) => {
      const ov = v.optionValues as Array<Record<string, string>>;
      return ov[0].name;
    });

    // Each must be unique
    expect(new Set(names).size).toBe(3);
    expect(names).toEqual(["Variant 1", "Variant 2", "Variant 3"]);
  });

  it("mixed: some variants have options, some don't", () => {
    const product = makeProduct({
      variants: [
        { sourceKey: "V1", sku: "A", options: { Color: "Red" }, price: "10", sourceData: {} },
        { sourceKey: "V2", sku: "B", options: {}, price: "20", sourceData: {} },
      ],
    });
    const { productSet } = _buildProductSetInput(product, null);
    const variants = productSet.variants as Array<Record<string, unknown>>;

    // First variant: real option
    const ov1 = variants[0].optionValues as Array<Record<string, string>>;
    expect(ov1[0].optionName).toBe("Color");
    expect(ov1[0].name).toBe("Red");

    // Second variant: default for Color
    const ov2 = variants[1].optionValues as Array<Record<string, string>>;
    expect(ov2[0].optionName).toBe("Color");
  });
});

// ---------------------------------------------------------------------------
// productOptions — must declare all option names + values
// ---------------------------------------------------------------------------

describe("buildProductOptions", () => {
  it("returns empty for product with no options", () => {
    const product = makeProduct({
      variants: [{ sourceKey: "V1", options: {}, price: "10", sourceData: {} }],
    });
    const options = _buildProductOptions(product);
    expect(options).toHaveLength(0);
  });

  it("collects unique values per option across variants", () => {
    const product = makeProduct({
      variants: [
        { sourceKey: "V1", options: { Color: "Red", Size: "S" }, price: "10", sourceData: {} },
        { sourceKey: "V2", options: { Color: "Blue", Size: "M" }, price: "10", sourceData: {} },
        { sourceKey: "V3", options: { Color: "Red", Size: "L" }, price: "10", sourceData: {} },
      ],
    });
    const options = _buildProductOptions(product);

    expect(options).toHaveLength(2);
    const colorOption = options.find((o) => o.name === "Color")!;
    const sizeOption = options.find((o) => o.name === "Size")!;

    expect(colorOption.values.map((v) => v.name)).toContain("Red");
    expect(colorOption.values.map((v) => v.name)).toContain("Blue");
    expect(sizeOption.values.map((v) => v.name)).toContain("S");
    expect(sizeOption.values.map((v) => v.name)).toContain("M");
    expect(sizeOption.values.map((v) => v.name)).toContain("L");
  });

  it("adds default values when some variants lack an option", () => {
    const product = makeProduct({
      variants: [
        { sourceKey: "V1", options: { Color: "Red" }, price: "10", sourceData: {} },
        { sourceKey: "V2", options: {}, price: "20", sourceData: {} },
      ],
    });
    const options = _buildProductOptions(product);
    const colorOption = options.find((o) => o.name === "Color")!;

    // Should have Red + a default for the variant without Color
    expect(colorOption.values.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Files (images) — must use "files" not "media", contentType not mediaContentType
// ---------------------------------------------------------------------------

describe("files (images) format", () => {
  it("uses 'files' field not 'media'", () => {
    const { productSet } = _buildProductSetInput(makeProduct(), null);
    expect(productSet).toHaveProperty("files");
    expect(productSet).not.toHaveProperty("media");
  });

  it("uses contentType not mediaContentType", () => {
    const { productSet } = _buildProductSetInput(makeProduct(), null);
    const files = productSet.files as Array<Record<string, string>>;
    expect(files[0]).toHaveProperty("contentType", "IMAGE");
    expect(files[0]).not.toHaveProperty("mediaContentType");
  });

  it("includes originalSource and alt", () => {
    const product = makeProduct({
      images: [{ sourceUrl: "https://img.com/a.jpg", altText: "Photo A", position: 1 }],
    });
    const { productSet } = _buildProductSetInput(product, null);
    const files = productSet.files as Array<Record<string, string>>;
    expect(files[0].originalSource).toBe("https://img.com/a.jpg");
    expect(files[0].alt).toBe("Photo A");
  });

  it("skips non-http image URLs", () => {
    const product = makeProduct({
      images: [
        { sourceUrl: "https://img.com/valid.jpg", position: 1 },
        { sourceUrl: "not-a-url", position: 2 },
      ],
    });
    const { productSet } = _buildProductSetInput(product, null);
    const files = productSet.files as Array<Record<string, string>>;
    expect(files).toHaveLength(1);
    expect(files[0].originalSource).toBe("https://img.com/valid.jpg");
  });

  it("omits files when no images", () => {
    const product = makeProduct({ images: [] });
    const { productSet } = _buildProductSetInput(product, null);
    expect(productSet.files).toBeUndefined();
  });
});
