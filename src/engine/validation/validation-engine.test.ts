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

// ---------------------------------------------------------------------------
// MISSING_SKU aggregation — one issue per product, not per variant
// ---------------------------------------------------------------------------

describe("MISSING_SKU aggregation", () => {
  it("emits one MISSING_SKU per product, not per variant", () => {
    const result = validateCatalog([
      product({
        sourceKey: "P1",
        variants: [
          { sourceKey: "V1", options: {}, price: "10", sourceData: {} },
          { sourceKey: "V2", options: {}, price: "20", sourceData: {} },
          { sourceKey: "V3", options: {}, price: "30", sourceData: {} },
        ],
      }),
    ]);
    const skuIssues = result.issues.filter((i) => i.code === "MISSING_SKU");
    expect(skuIssues).toHaveLength(1); // one per product, not three
    expect(skuIssues[0].sourceKey).toBe("P1");
    expect(skuIssues[0].message).toContain("3 variants");
  });

  it("shows singular 'variant' for a single missing SKU", () => {
    const result = validateCatalog([
      product({
        sourceKey: "P1",
        variants: [
          { sourceKey: "V1", options: {}, price: "10", sourceData: {} },
        ],
      }),
    ]);
    const skuIssues = result.issues.filter((i) => i.code === "MISSING_SKU");
    expect(skuIssues).toHaveLength(1);
    expect(skuIssues[0].message).toContain("1 variant ");
    expect(skuIssues[0].message).not.toContain("variants");
  });

  it("does not emit MISSING_SKU for products with all SKUs present", () => {
    const result = validateCatalog([
      product({
        sourceKey: "P1",
        variants: [
          { sourceKey: "V1", sku: "A", options: {}, price: "10", sourceData: {} },
          { sourceKey: "V2", sku: "B", options: {}, price: "20", sourceData: {} },
        ],
      }),
    ]);
    const skuIssues = result.issues.filter((i) => i.code === "MISSING_SKU");
    expect(skuIssues).toHaveLength(0);
  });

  it("emits separate MISSING_SKU for each affected product", () => {
    const result = validateCatalog([
      product({
        sourceKey: "P1",
        variants: [{ sourceKey: "V1", options: {}, price: "10", sourceData: {} }],
      }),
      product({
        sourceKey: "P2",
        variants: [
          { sourceKey: "V2", sku: "HAS-SKU", options: {}, price: "10", sourceData: {} },
        ],
      }),
      product({
        sourceKey: "P3",
        variants: [{ sourceKey: "V3", options: {}, price: "10", sourceData: {} }],
      }),
    ]);
    const skuIssues = result.issues.filter((i) => i.code === "MISSING_SKU");
    expect(skuIssues).toHaveLength(2); // P1 and P3, not P2
    expect(skuIssues.map((i) => i.sourceKey).sort()).toEqual(["P1", "P3"]);
  });

  it("MISSING_SKU is a warning, never blocking", () => {
    const result = validateCatalog([
      product({
        variants: [{ sourceKey: "V1", options: {}, price: "10", sourceData: {} }],
      }),
    ]);
    const skuIssues = result.issues.filter((i) => i.code === "MISSING_SKU");
    expect(skuIssues).toHaveLength(1);
    expect(skuIssues[0].severity).toBe("warning");
  });
});

// ---------------------------------------------------------------------------
// SKU coverage
// ---------------------------------------------------------------------------

describe("skuCoverage", () => {
  it("counts total variants across all products", () => {
    const result = validateCatalog([
      product({
        sourceKey: "P1",
        variants: [
          { sourceKey: "V1", sku: "A", options: {}, price: "10", sourceData: {} },
          { sourceKey: "V2", options: {}, price: "20", sourceData: {} },
        ],
      }),
      product({
        sourceKey: "P2",
        variants: [
          { sourceKey: "V3", sku: "B", options: {}, price: "30", sourceData: {} },
        ],
      }),
    ]);
    expect(result.skuCoverage.totalVariants).toBe(3);
  });

  it("counts withSku for supplier/merchant SKUs", () => {
    const result = validateCatalog([
      product({
        sourceKey: "P1",
        variants: [
          { sourceKey: "V1", sku: "SUP-1", options: {}, price: "10", sourceData: {} },
          { sourceKey: "V2", sku: "SUP-2", skuSource: "MERCHANT", options: {}, price: "20", sourceData: {} },
        ],
      }),
    ]);
    expect(result.skuCoverage.withSku).toBe(2);
    expect(result.skuCoverage.missingSku).toBe(0);
  });

  it("counts generatedSku separately from withSku", () => {
    const result = validateCatalog([
      product({
        sourceKey: "P1",
        variants: [
          { sourceKey: "V1", sku: "GEN-001", skuSource: "STOREDELIVERY_GENERATED", options: {}, price: "10", sourceData: {} },
          { sourceKey: "V2", sku: "SUP-1", options: {}, price: "20", sourceData: {} },
        ],
      }),
    ]);
    expect(result.skuCoverage.generatedSku).toBe(1);
    expect(result.skuCoverage.withSku).toBe(1);
    expect(result.skuCoverage.missingSku).toBe(0);
  });

  it("counts missingSku and productsAffected", () => {
    const result = validateCatalog([
      product({
        sourceKey: "P1",
        variants: [
          { sourceKey: "V1", options: {}, price: "10", sourceData: {} },
          { sourceKey: "V2", options: {}, price: "20", sourceData: {} },
        ],
      }),
      product({
        sourceKey: "P2",
        variants: [
          { sourceKey: "V3", sku: "OK", options: {}, price: "30", sourceData: {} },
        ],
      }),
    ]);
    expect(result.skuCoverage.missingSku).toBe(2);
    expect(result.skuCoverage.productsAffected).toBe(1); // only P1
  });

  it("counts duplicateSkus", () => {
    const result = validateCatalog([
      product({
        sourceKey: "P1",
        variants: [{ sourceKey: "V1", sku: "DUPE", options: {}, price: "10", sourceData: {} }],
      }),
      product({
        sourceKey: "P2",
        variants: [{ sourceKey: "V2", sku: "DUPE", options: {}, price: "20", sourceData: {} }],
      }),
    ]);
    expect(result.skuCoverage.duplicateSkus).toBe(1); // "DUPE" is one duplicate
  });

  it("returns zero coverage for empty product list", () => {
    const result = validateCatalog([]);
    expect(result.skuCoverage.totalVariants).toBe(0);
    expect(result.skuCoverage.withSku).toBe(0);
    expect(result.skuCoverage.missingSku).toBe(0);
    expect(result.skuCoverage.generatedSku).toBe(0);
  });
});
