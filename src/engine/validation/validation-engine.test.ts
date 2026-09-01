import { describe, it, expect } from "vitest";
import { validateCatalog } from "./validation-engine.js";
import type { CatalogProduct } from "@shared/types/catalog.js";

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    sourceKey: "TEST-001",
    title: "Test Product",
    tags: [],
    variants: [
      {
        sourceKey: "TEST-001-V1",
        sku: "TEST-001",
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

describe("validateCatalog", () => {
  it("returns no issues for a clean product", () => {
    const result = validateCatalog([product()]);
    expect(result.blockingCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  // --- Blocking ---

  it("blocks: no products at all", () => {
    const result = validateCatalog([]);
    expect(result.blockingCount).toBe(1);
    expect(result.issues[0].code).toBe("NO_PRODUCTS");
  });

  it("blocks: missing title", () => {
    const result = validateCatalog([product({ title: "" })]);
    expect(result.blockingCount).toBe(1);
    expect(result.issues.find((i) => i.code === "MISSING_TITLE")).toBeTruthy();
  });

  it("blocks: no variants", () => {
    const result = validateCatalog([product({ variants: [] })]);
    expect(result.blockingCount).toBe(1);
    expect(result.issues.find((i) => i.code === "NO_VARIANTS")).toBeTruthy();
  });

  it("blocks: malformed price", () => {
    const result = validateCatalog([
      product({
        variants: [
          {
            sourceKey: "V1",
            options: {},
            price: "not-a-price",
            sourceData: {},
          },
        ],
      }),
    ]);
    expect(result.blockingCount).toBe(1);
    expect(result.issues.find((i) => i.code === "MALFORMED_PRICE")).toBeTruthy();
  });

  // --- Warnings ---

  it("warns: missing SKU", () => {
    const result = validateCatalog([
      product({
        variants: [
          { sourceKey: "V1", options: {}, price: "10.00", sourceData: {} },
        ],
      }),
    ]);
    expect(result.warningCount).toBeGreaterThanOrEqual(1);
    expect(result.issues.find((i) => i.code === "MISSING_SKU")).toBeTruthy();
  });

  it("warns: duplicate SKU across products", () => {
    const result = validateCatalog([
      product({ sourceKey: "A" }),
      product({ sourceKey: "B" }),
    ]);
    // Both have SKU "TEST-001"
    expect(result.issues.find((i) => i.code === "DUPLICATE_SKU")).toBeTruthy();
  });

  it("warns: duplicate barcode", () => {
    const result = validateCatalog([
      product({
        sourceKey: "A",
        variants: [
          {
            sourceKey: "V1",
            sku: "A-001",
            barcode: "1234567890",
            options: {},
            price: "10.00",
            sourceData: {},
          },
        ],
      }),
      product({
        sourceKey: "B",
        variants: [
          {
            sourceKey: "V2",
            sku: "B-001",
            barcode: "1234567890",
            options: {},
            price: "20.00",
            sourceData: {},
          },
        ],
      }),
    ]);
    expect(
      result.issues.find((i) => i.code === "DUPLICATE_BARCODE"),
    ).toBeTruthy();
  });

  it("warns: suspiciously high price", () => {
    const result = validateCatalog([
      product({
        variants: [
          {
            sourceKey: "V1",
            sku: "X",
            options: {},
            price: "150000.00",
            sourceData: {},
          },
        ],
      }),
    ]);
    expect(
      result.issues.find((i) => i.code === "SUSPICIOUS_HIGH_PRICE"),
    ).toBeTruthy();
  });

  it("warns: suspiciously low price", () => {
    const result = validateCatalog([
      product({
        variants: [
          {
            sourceKey: "V1",
            sku: "X",
            options: {},
            price: "0.001",
            sourceData: {},
          },
        ],
      }),
    ]);
    expect(
      result.issues.find((i) => i.code === "SUSPICIOUS_LOW_PRICE"),
    ).toBeTruthy();
  });

  it("warns: invalid image URL", () => {
    const result = validateCatalog([
      product({
        images: [{ sourceUrl: "not-a-url", position: 1 }],
      }),
    ]);
    expect(
      result.issues.find((i) => i.code === "INVALID_IMAGE_URL"),
    ).toBeTruthy();
  });

  it("warns: empty option value", () => {
    const result = validateCatalog([
      product({
        variants: [
          {
            sourceKey: "V1",
            sku: "X",
            options: { Color: "" },
            price: "10.00",
            sourceData: {},
          },
        ],
      }),
    ]);
    expect(
      result.issues.find((i) => i.code === "EMPTY_OPTION"),
    ).toBeTruthy();
  });

  // --- Clean ---

  it("reports zero issues for well-formed products", () => {
    const products = [
      product({
        sourceKey: "A",
        title: "Widget",
        variants: [
          {
            sourceKey: "A-V1",
            sku: "A-001",
            barcode: "111111111111",
            options: { Color: "Red" },
            price: "24.99",
            sourceData: {},
          },
        ],
        images: [
          { sourceUrl: "https://img.example.com/a.jpg", position: 1 },
        ],
      }),
      product({
        sourceKey: "B",
        title: "Gadget",
        variants: [
          {
            sourceKey: "B-V1",
            sku: "B-001",
            barcode: "222222222222",
            options: { Size: "M" },
            price: "49.99",
            sourceData: {},
          },
        ],
        images: [
          { sourceUrl: "https://img.example.com/b.jpg", position: 1 },
        ],
      }),
    ];

    const result = validateCatalog(products);
    expect(result.blockingCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.infoCount).toBe(0);
  });

  // --- Summary counts ---

  it("provides correct summary counts", () => {
    const result = validateCatalog([
      product({ title: "", sourceKey: "A" }), // blocking: missing title
      product({
        sourceKey: "B",
        variants: [
          { sourceKey: "V1", options: {}, price: "10.00", sourceData: {} }, // warning: missing SKU
        ],
        images: [{ sourceUrl: "bad-url", position: 1 }], // warning: invalid image
      }),
    ]);

    expect(result.blockingCount).toBeGreaterThanOrEqual(1);
    expect(result.warningCount).toBeGreaterThanOrEqual(2);
  });
});
