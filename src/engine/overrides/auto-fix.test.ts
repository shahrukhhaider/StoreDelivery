import { describe, it, expect } from "vitest";
import { detectAutoFixes, detectAllAutoFixes } from "./auto-fix.js";
import type { CatalogProduct } from "@shared/types/catalog.js";

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    sourceKey: "TEST",
    title: "Clean Title",
    tags: [],
    variants: [
      {
        sourceKey: "V1",
        sku: "SKU-001",
        options: {},
        price: "24.99",
        sourceData: {},
      },
    ],
    images: [],
    sourceData: {},
    ...overrides,
  };
}

describe("detectAutoFixes", () => {
  it("returns no fixes for clean product", () => {
    const fixes = detectAutoFixes(product());
    expect(fixes).toHaveLength(0);
  });

  // Whitespace fixes
  it("fixes title whitespace", () => {
    const fixes = detectAutoFixes(product({ title: "  Extra   Spaces  " }));
    expect(fixes).toHaveLength(1);
    expect(fixes[0].field).toBe("title");
    expect(fixes[0].newValue).toBe("Extra Spaces");
    expect(fixes[0].source).toBe("auto_fix");
  });

  it("fixes description trailing whitespace", () => {
    const fixes = detectAutoFixes(product({ description: "  Hello  " }));
    expect(fixes).toHaveLength(1);
    expect(fixes[0].field).toBe("description");
    expect(fixes[0].newValue).toBe("Hello");
  });

  it("fixes vendor whitespace", () => {
    const fixes = detectAutoFixes(product({ vendor: " Acme " }));
    expect(fixes).toHaveLength(1);
    expect(fixes[0].field).toBe("vendor");
    expect(fixes[0].newValue).toBe("Acme");
  });

  // Currency cleanup
  it("strips dollar sign from price", () => {
    const fixes = detectAutoFixes(
      product({
        variants: [
          { sourceKey: "V1", sku: "A", options: {}, price: "$24.99", sourceData: {} },
        ],
      }),
    );
    const priceFix = fixes.find((f) => f.field === "variants[0].price");
    expect(priceFix?.newValue).toBe("24.99");
  });

  it("strips euro sign from price", () => {
    const fixes = detectAutoFixes(
      product({
        variants: [
          { sourceKey: "V1", sku: "A", options: {}, price: "€29.99", sourceData: {} },
        ],
      }),
    );
    const priceFix = fixes.find((f) => f.field === "variants[0].price");
    expect(priceFix?.newValue).toBe("29.99");
  });

  it("strips currency from compareAtPrice and cost", () => {
    const fixes = detectAutoFixes(
      product({
        variants: [
          {
            sourceKey: "V1",
            sku: "A",
            options: {},
            price: "10.00",
            compareAtPrice: "$15.00",
            cost: "£5.00",
            sourceData: {},
          },
        ],
      }),
    );
    expect(fixes.find((f) => f.field === "variants[0].compareAtPrice")?.newValue).toBe("15.00");
    expect(fixes.find((f) => f.field === "variants[0].cost")?.newValue).toBe("5.00");
  });

  // SKU/barcode whitespace
  it("trims SKU whitespace", () => {
    const fixes = detectAutoFixes(
      product({
        variants: [
          { sourceKey: "V1", sku: " SKU-001 ", options: {}, price: "10", sourceData: {} },
        ],
      }),
    );
    const skuFix = fixes.find((f) => f.field === "variants[0].sku");
    expect(skuFix?.newValue).toBe("SKU-001");
  });

  it("trims barcode whitespace", () => {
    const fixes = detectAutoFixes(
      product({
        variants: [
          {
            sourceKey: "V1",
            sku: "A",
            barcode: " 1234567890 ",
            options: {},
            price: "10",
            sourceData: {},
          },
        ],
      }),
    );
    const fix = fixes.find((f) => f.field === "variants[0].barcode");
    expect(fix?.newValue).toBe("1234567890");
  });

  // Weight unit normalization
  it("normalizes weight unit lbs → lb", () => {
    const fixes = detectAutoFixes(
      product({
        variants: [
          {
            sourceKey: "V1",
            sku: "A",
            options: {},
            price: "10",
            weightUnit: "lbs",
            sourceData: {},
          },
        ],
      }),
    );
    const fix = fixes.find((f) => f.field === "variants[0].weightUnit");
    expect(fix?.newValue).toBe("lb");
  });

  it("normalizes weight unit Pounds → lb", () => {
    const fixes = detectAutoFixes(
      product({
        variants: [
          {
            sourceKey: "V1",
            sku: "A",
            options: {},
            price: "10",
            weightUnit: "Pounds",
            sourceData: {},
          },
        ],
      }),
    );
    const fix = fixes.find((f) => f.field === "variants[0].weightUnit");
    expect(fix?.newValue).toBe("lb");
  });

  // Multiple fixes on one product
  it("detects multiple fixes on one product", () => {
    const fixes = detectAutoFixes(
      product({
        title: "  Messy  Title  ",
        vendor: " Vendor ",
        variants: [
          {
            sourceKey: "V1",
            sku: " SKU ",
            options: {},
            price: "$19.99",
            weightUnit: "kilograms",
            sourceData: {},
          },
        ],
      }),
    );
    expect(fixes.length).toBeGreaterThanOrEqual(4);
  });
});

describe("detectAllAutoFixes", () => {
  it("returns summary for batch of products", () => {
    const products = [
      product({ title: "  Needs Fix  " }),
      product(), // clean
      product({
        variants: [
          { sourceKey: "V1", sku: "A", options: {}, price: "$10", sourceData: {} },
        ],
      }),
    ];

    const summary = detectAllAutoFixes(products);
    expect(summary.totalFixed).toBeGreaterThanOrEqual(2);
    expect(summary.totalSkipped).toBe(1); // clean product
    expect(summary.breakdown).toHaveProperty("whitespace_normalization");
  });

  it("returns empty for all-clean products", () => {
    const summary = detectAllAutoFixes([product(), product()]);
    expect(summary.totalFixed).toBe(0);
    expect(summary.totalSkipped).toBe(2);
  });
});
