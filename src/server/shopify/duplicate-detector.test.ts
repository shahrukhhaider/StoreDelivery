/**
 * Duplicate Detector tests — pure function tests for detectDuplicates.
 * No Shopify API calls — tests the matching logic with mock data.
 */

import { describe, it, expect } from "vitest";
import { detectDuplicates, type DuplicateMatch } from "./duplicate-detector.js";
import type { CatalogProduct } from "@shared/types/catalog.js";

function product(key: string, sku?: string, barcode?: string): CatalogProduct {
  return {
    sourceKey: key,
    title: `Product ${key}`,
    tags: [],
    variants: [{
      sourceKey: `${key}-V1`,
      sku: sku ?? undefined,
      barcode: barcode ?? undefined,
      options: {},
      price: "10.00",
      sourceData: {},
    }],
    images: [],
    sourceData: {},
  };
}

function existing(
  skus: Record<string, string> = {},
  barcodes: Record<string, string> = {},
  titles: Record<string, string> = {},
) {
  return {
    skus: new Map(Object.entries(skus)),
    barcodes: new Map(Object.entries(barcodes)),
    titles: new Map(Object.entries(titles)),
  };
}

// ---------------------------------------------------------------------------
// No duplicates
// ---------------------------------------------------------------------------

describe("detectDuplicates — no matches", () => {
  it("returns empty when store has no products", () => {
    const products = [product("P1", "SKU-001"), product("P2", "SKU-002")];
    const result = detectDuplicates(products, existing());
    expect(result).toHaveLength(0);
  });

  it("returns empty when SKUs don't match", () => {
    const products = [product("P1", "NEW-001"), product("P2", "NEW-002")];
    const store = existing({ "old-001": "gid://1", "old-002": "gid://2" });
    const result = detectDuplicates(products, store);
    expect(result).toHaveLength(0);
  });

  it("returns empty when products have no SKUs or barcodes", () => {
    const products = [product("P1"), product("P2")];
    const store = existing({ "some-sku": "gid://1" });
    const result = detectDuplicates(products, store);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SKU matches
// ---------------------------------------------------------------------------

describe("detectDuplicates — SKU matching", () => {
  it("detects exact SKU match", () => {
    const products = [product("P1", "SKU-001")];
    const store = existing({ "sku-001": "gid://shopify/Product/123" });
    const result = detectDuplicates(products, store);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sourceKey: "P1",
      matchType: "sku",
      matchValue: "SKU-001",
      existingShopifyProductId: "gid://shopify/Product/123",
    });
  });

  it("matches case-insensitive", () => {
    const products = [product("P1", "ABC-123")];
    const store = existing({ "abc-123": "gid://1" });
    const result = detectDuplicates(products, store);
    expect(result).toHaveLength(1);
  });

  it("matches with whitespace trimming", () => {
    const products = [product("P1", "  SKU-001  ")];
    const store = existing({ "sku-001": "gid://1" });
    const result = detectDuplicates(products, store);
    expect(result).toHaveLength(1);
  });

  it("detects multiple products with matching SKUs", () => {
    const products = [
      product("P1", "SKU-001"),
      product("P2", "SKU-002"),
      product("P3", "SKU-NEW"),
    ];
    const store = existing({ "sku-001": "gid://1", "sku-002": "gid://2" });
    const result = detectDuplicates(products, store);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.sourceKey)).toContain("P1");
    expect(result.map((r) => r.sourceKey)).toContain("P2");
    expect(result.map((r) => r.sourceKey)).not.toContain("P3");
  });

  it("only reports one match per product even with multiple variant SKUs", () => {
    const p: CatalogProduct = {
      sourceKey: "P1",
      title: "Multi Variant",
      tags: [],
      variants: [
        { sourceKey: "V1", sku: "EXISTING-SKU", options: {}, price: "10", sourceData: {} },
        { sourceKey: "V2", sku: "ALSO-EXISTING", options: {}, price: "20", sourceData: {} },
      ],
      images: [],
      sourceData: {},
    };
    const store = existing({ "existing-sku": "gid://1", "also-existing": "gid://2" });
    const result = detectDuplicates([p], store);

    // Should only report first match, not both
    expect(result).toHaveLength(1);
    expect(result[0].matchValue).toBe("EXISTING-SKU");
  });
});

// ---------------------------------------------------------------------------
// Barcode matches
// ---------------------------------------------------------------------------

describe("detectDuplicates — barcode matching", () => {
  it("detects barcode match when SKU doesn't match", () => {
    const products = [product("P1", "NEW-SKU", "1234567890")];
    const store = existing({}, { "1234567890": "gid://shopify/Product/456" });
    const result = detectDuplicates(products, store);

    expect(result).toHaveLength(1);
    expect(result[0].matchType).toBe("barcode");
    expect(result[0].matchValue).toBe("1234567890");
  });

  it("prefers SKU match over barcode match", () => {
    const products = [product("P1", "EXISTING-SKU", "EXISTING-BARCODE")];
    const store = existing(
      { "existing-sku": "gid://1" },
      { "existing-barcode": "gid://2" },
    );
    const result = detectDuplicates(products, store);

    // SKU checked first — should match on SKU, not barcode
    expect(result).toHaveLength(1);
    expect(result[0].matchType).toBe("sku");
  });

  it("falls through to barcode when no SKU", () => {
    const products = [product("P1", undefined, "9876543210")];
    const store = existing({}, { "9876543210": "gid://1" });
    const result = detectDuplicates(products, store);

    expect(result).toHaveLength(1);
    expect(result[0].matchType).toBe("barcode");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("detectDuplicates — edge cases", () => {
  it("handles empty product list", () => {
    const result = detectDuplicates([], existing({ "sku": "gid://1" }));
    expect(result).toHaveLength(0);
  });

  it("handles empty store identifiers", () => {
    const result = detectDuplicates([product("P1", "SKU")], existing());
    expect(result).toHaveLength(0);
  });

  it("handles product with empty SKU string", () => {
    const products = [product("P1", "")];
    const store = existing({ "": "gid://1" }); // pathological case
    const result = detectDuplicates(products, store);
    // Empty SKU should not match
    expect(result).toHaveLength(0);
  });

  it("handles product with empty barcode string", () => {
    const products = [product("P1", undefined, "")];
    const store = existing({}, { "": "gid://1" });
    const result = detectDuplicates(products, store);
    expect(result).toHaveLength(0);
  });
});
