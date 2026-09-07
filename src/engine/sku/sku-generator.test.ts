import { describe, it, expect } from "vitest";
import {
  generateSkus,
  previewSkus,
  collectCatalogSkus,
  DEFAULT_SKU_FORMAT,
} from "./sku-generator.js";
import type { CatalogProduct } from "@shared/types/catalog.js";

function makeProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    sourceKey: "classic-tee",
    title: "Classic Tee",
    tags: [],
    variants: [
      { sourceKey: "V1", options: { Color: "Red" }, price: "19.99", sourceData: {} },
      { sourceKey: "V2", options: { Color: "Blue" }, price: "19.99", sourceData: {} },
    ],
    images: [],
    sourceData: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Format expansion
// ---------------------------------------------------------------------------

describe("generateSkus — format expansion", () => {
  it("uses default format {productHandle}-{variantIndex:003}", () => {
    const result = generateSkus([makeProduct()], { format: DEFAULT_SKU_FORMAT });
    expect(result.generated).toHaveLength(2);
    expect(result.generated[0].sku).toBe("classic-tee-001");
    expect(result.generated[1].sku).toBe("classic-tee-002");
  });

  it("sanitizes product handle: lowercase, replace non-alnum with hyphens", () => {
    const product = makeProduct({ sourceKey: "ACS Crossfire Chain!!" });
    const result = generateSkus([product], { format: "{productHandle}-{variantIndex:003}" });
    expect(result.generated[0].sku).toBe("acs-crossfire-chain-001");
  });

  it("supports custom format without padding", () => {
    const result = generateSkus([makeProduct()], { format: "SKU-{productHandle}-{variantIndex}" });
    // {variantIndex} without :NNN still pads to 3 by default
    // Literal "SKU-" prefix is preserved as-is (not lowercased)
    expect(result.generated[0].sku).toBe("SKU-classic-tee-001");
  });

  it("supports wider padding like :00005", () => {
    const result = generateSkus([makeProduct()], { format: "{productHandle}-{variantIndex:00005}" });
    expect(result.generated[0].sku).toBe("classic-tee-00001");
  });

  it("marks all generated SKUs with STOREDELIVERY_GENERATED source", () => {
    const result = generateSkus([makeProduct()], { format: DEFAULT_SKU_FORMAT });
    for (const gen of result.generated) {
      expect(gen.skuSource).toBe("STOREDELIVERY_GENERATED");
    }
  });
});

// ---------------------------------------------------------------------------
// Preserves existing SKUs
// ---------------------------------------------------------------------------

describe("generateSkus — existing SKU preservation", () => {
  it("never touches variants that already have a SKU", () => {
    const product = makeProduct({
      variants: [
        { sourceKey: "V1", sku: "EXISTING-SKU", options: {}, price: "10", sourceData: {} },
        { sourceKey: "V2", options: { Color: "Blue" }, price: "10", sourceData: {} },
      ],
    });
    const result = generateSkus([product], { format: DEFAULT_SKU_FORMAT });
    expect(result.generated).toHaveLength(1);
    expect(result.generated[0].sku).toBe("classic-tee-002");
    expect(result.totalMissing).toBe(1);
  });

  it("counts all missing variants correctly", () => {
    const result = generateSkus([makeProduct()], { format: DEFAULT_SKU_FORMAT });
    expect(result.totalMissing).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.collisionCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Collision detection — catalog
// ---------------------------------------------------------------------------

describe("generateSkus — catalog collision detection", () => {
  it("reports collision with existing catalog SKU", () => {
    const existing = new Map([["classic-tee-001", "Other Product / classic-tee-001"]]);
    const result = generateSkus([makeProduct()], {
      format: DEFAULT_SKU_FORMAT,
      existingCatalogSkus: existing,
    });
    expect(result.collisionCount).toBe(1);
    const collision = result.collisions[0];
    expect(collision.generatedSku).toBe("classic-tee-001");
    expect(collision.collisionType).toBe("catalog");
    // Second variant should still succeed
    expect(result.successCount).toBe(1);
    expect(result.generated[0].sku).toBe("classic-tee-002");
  });
});

// ---------------------------------------------------------------------------
// Collision detection — Shopify
// ---------------------------------------------------------------------------

describe("generateSkus — Shopify collision detection", () => {
  it("reports collision with existing Shopify SKU", () => {
    const shopifySkus = new Map([["classic-tee-002", "Crossfire Chain / Red / Medium"]]);
    const result = generateSkus([makeProduct()], {
      format: DEFAULT_SKU_FORMAT,
      existingShopifySkus: shopifySkus,
    });
    expect(result.collisions).toHaveLength(1);
    expect(result.collisions[0].collisionType).toBe("shopify");
    expect(result.collisions[0].collidesWithDescription).toBe("Crossfire Chain / Red / Medium");
  });
});

// ---------------------------------------------------------------------------
// Batch uniqueness
// ---------------------------------------------------------------------------

describe("generateSkus — batch uniqueness", () => {
  it("detects duplicate SKUs within the same generation batch", () => {
    // Two products with same sourceKey → same generated SKU
    const products = [
      makeProduct({ sourceKey: "tee", variants: [{ sourceKey: "V1", options: {}, price: "10", sourceData: {} }] }),
      makeProduct({ sourceKey: "tee", variants: [{ sourceKey: "V2", options: {}, price: "20", sourceData: {} }] }),
    ];
    const result = generateSkus(products, { format: DEFAULT_SKU_FORMAT });
    // First product's variant succeeds, second collides within the batch
    expect(result.successCount).toBe(1);
    expect(result.collisionCount).toBe(1);
    expect(result.collisions[0].collisionType).toBe("catalog"); // within-batch is treated as catalog collision
  });
});

// ---------------------------------------------------------------------------
// Blank format / edge cases
// ---------------------------------------------------------------------------

describe("generateSkus — edge cases", () => {
  it("returns empty result for blank format", () => {
    const result = generateSkus([makeProduct()], { format: "" });
    expect(result.generated).toHaveLength(0);
    expect(result.totalMissing).toBe(0);
  });

  it("trims whitespace from format", () => {
    const result = generateSkus([makeProduct()], { format: "  {productHandle}-{variantIndex:003}  " });
    expect(result.generated[0].sku).toBe("classic-tee-001");
  });

  it("respects filterSourceKeys", () => {
    const products = [
      makeProduct({ sourceKey: "A", variants: [{ sourceKey: "V1", options: {}, price: "10", sourceData: {} }] }),
      makeProduct({ sourceKey: "B", variants: [{ sourceKey: "V2", options: {}, price: "20", sourceData: {} }] }),
    ];
    const result = generateSkus(products, {
      format: DEFAULT_SKU_FORMAT,
      filterSourceKeys: new Set(["A"]),
    });
    expect(result.generated).toHaveLength(1);
    expect(result.generated[0].productSourceKey).toBe("A");
  });

  it("includes variantSourceKey in generated output", () => {
    const result = generateSkus([makeProduct()], { format: DEFAULT_SKU_FORMAT });
    expect(result.generated[0].variantSourceKey).toBe("V1");
    expect(result.generated[1].variantSourceKey).toBe("V2");
  });
});

// ---------------------------------------------------------------------------
// previewSkus
// ---------------------------------------------------------------------------

describe("previewSkus", () => {
  it("returns sample SKUs for variants missing them", () => {
    const previews = previewSkus([makeProduct()], DEFAULT_SKU_FORMAT, 3);
    expect(previews).toHaveLength(2); // only 2 variants missing SKUs
    expect(previews[0]).toBe("classic-tee-001");
    expect(previews[1]).toBe("classic-tee-002");
  });

  it("skips variants that have SKUs", () => {
    const product = makeProduct({
      variants: [
        { sourceKey: "V1", sku: "HAS-SKU", options: {}, price: "10", sourceData: {} },
        { sourceKey: "V2", options: { Color: "Blue" }, price: "20", sourceData: {} },
      ],
    });
    const previews = previewSkus([product], DEFAULT_SKU_FORMAT, 3);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toBe("classic-tee-002");
  });

  it("limits output to count", () => {
    const manyVariants = Array.from({ length: 10 }, (_, i) => ({
      sourceKey: `V${i}`,
      options: {},
      price: "10",
      sourceData: {},
    }));
    const product = makeProduct({ variants: manyVariants });
    const previews = previewSkus([product], DEFAULT_SKU_FORMAT, 3);
    expect(previews).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// collectCatalogSkus
// ---------------------------------------------------------------------------

describe("collectCatalogSkus", () => {
  it("collects SKUs into lowercase map with product description", () => {
    const product = makeProduct({
      variants: [
        { sourceKey: "V1", sku: "SKU-AAA", options: {}, price: "10", sourceData: {} },
        { sourceKey: "V2", sku: "SKU-BBB", options: {}, price: "20", sourceData: {} },
      ],
    });
    const skus = collectCatalogSkus([product]);
    expect(skus.size).toBe(2);
    expect(skus.get("sku-aaa")).toBe("Classic Tee / SKU-AAA");
    expect(skus.get("sku-bbb")).toBe("Classic Tee / SKU-BBB");
  });

  it("skips variants without SKUs", () => {
    const skus = collectCatalogSkus([makeProduct()]);
    expect(skus.size).toBe(0);
  });

  it("is case-insensitive (lowercase keys)", () => {
    const product = makeProduct({
      variants: [
        { sourceKey: "V1", sku: "ABC-123", options: {}, price: "10", sourceData: {} },
      ],
    });
    const skus = collectCatalogSkus([product]);
    expect(skus.has("abc-123")).toBe(true);
  });
});
