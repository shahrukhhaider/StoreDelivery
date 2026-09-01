import { describe, it, expect } from "vitest";
import { normalizeHeader, lookupAlias } from "./aliases.js";

describe("normalizeHeader", () => {
  it("lowercases", () => {
    expect(normalizeHeader("SKU")).toBe("sku");
  });

  it("trims", () => {
    expect(normalizeHeader("  SKU  ")).toBe("sku");
  });

  it("collapses whitespace", () => {
    expect(normalizeHeader("Product   Name")).toBe("product name");
  });

  it("removes trailing periods", () => {
    expect(normalizeHeader("Item No.")).toBe("item no");
  });
});

describe("lookupAlias", () => {
  it("matches exact alias", () => {
    expect(lookupAlias("SKU")).toEqual({ target: "variant.sku" });
  });

  it("matches case-insensitive", () => {
    expect(lookupAlias("Product Name")).toEqual({ target: "product.title" });
  });

  it("matches with extra whitespace", () => {
    expect(lookupAlias("  Item   Number  ")).toEqual({ target: "variant.sku" });
  });

  it("matches trailing period: Item No.", () => {
    expect(lookupAlias("Item No.")).toEqual({ target: "variant.sku" });
  });

  it("returns null for unknown header", () => {
    expect(lookupAlias("Xylophone Rating")).toBeNull();
  });

  it("matches numbered image columns", () => {
    const result = lookupAlias("Image 2");
    expect(result).toEqual({ target: "image.url", imagePosition: 2 });
  });

  it("matches numbered image without space", () => {
    const result = lookupAlias("image3");
    expect(result).toEqual({ target: "image.url", imagePosition: 3 });
  });

  it("matches Photo as image", () => {
    expect(lookupAlias("Photo 5")).toEqual({
      target: "image.url",
      imagePosition: 5,
    });
  });

  it("maps common price aliases", () => {
    expect(lookupAlias("Retail Price")).toEqual({ target: "variant.price" });
    expect(lookupAlias("MSRP")).toEqual({ target: "variant.price" });
    expect(lookupAlias("RRP")).toEqual({ target: "variant.price" });
  });

  it("maps cost aliases", () => {
    expect(lookupAlias("Wholesale")).toEqual({ target: "variant.cost" });
    expect(lookupAlias("Cost Price")).toEqual({ target: "variant.cost" });
    expect(lookupAlias("Net Price")).toEqual({ target: "variant.cost" });
  });

  it("maps barcode aliases", () => {
    expect(lookupAlias("UPC")).toEqual({ target: "variant.barcode" });
    expect(lookupAlias("EAN")).toEqual({ target: "variant.barcode" });
    expect(lookupAlias("GTIN")).toEqual({ target: "variant.barcode" });
  });

  it("maps grouping aliases", () => {
    expect(lookupAlias("Parent SKU")).toEqual({ target: "grouping.parentKey" });
    expect(lookupAlias("Group ID")).toEqual({ target: "grouping.parentKey" });
  });
});
