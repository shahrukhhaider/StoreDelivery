import { describe, it, expect } from "vitest";
import { classifyProducts, type ClassifyProductsInput } from "./reconciliation-engine.js";
import type { CatalogProduct } from "@shared/types/catalog.js";
import type {
  PersistedProductMapping,
  ShopifyIdentityIndex,
} from "@shared/types/reconciliation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    sourceKey: "PROD-001",
    title: "Test Product",
    tags: [],
    variants: [
      { sourceKey: "V1", sku: "SKU-001", options: {}, price: "24.99", sourceData: {} },
    ],
    images: [],
    sourceData: {},
    ...overrides,
  };
}

function emptyIndex(): ShopifyIdentityIndex {
  return { skus: new Map(), barcodes: new Map(), titles: new Map() };
}

function emptyMappings(): Map<string, PersistedProductMapping> {
  return new Map();
}

function mapping(sourceKey: string, shopifyProductId: string): PersistedProductMapping {
  return {
    id: `pm-${sourceKey}`,
    sourceProductKey: sourceKey,
    sourceProductFingerprint: sourceKey.toLowerCase(),
    shopifyProductId,
    mappingStatus: "MAPPED",
    variants: [],
  };
}

// ---------------------------------------------------------------------------
// Classification: persisted mapping → EXISTING_MAPPED
// ---------------------------------------------------------------------------

describe("classifyProducts — persisted mapping", () => {
  it("classifies product with MAPPED persisted mapping as EXISTING_MAPPED", () => {
    const mappings = new Map([["PROD-001", mapping("PROD-001", "gid://shopify/Product/1")]]);
    const { classifications, summary } = classifyProducts({
      products: [product()],
      existingMappings: mappings,
      shopifyIndex: emptyIndex(),
    });

    expect(classifications).toHaveLength(1);
    expect(classifications[0].classification).toBe("EXISTING_MAPPED");
    expect(classifications[0].proposedAction).toBe("NO_CHANGE");
    expect(classifications[0].matchedShopifyProductId).toBe("gid://shopify/Product/1");
    expect(classifications[0].productMappingId).toBe("pm-PROD-001");
    expect(classifications[0].confidence).toBe("HIGH");
    expect(summary.existingMapped).toBe(1);
  });

  it("persisted mapping beats Shopify evidence — mapping always wins", () => {
    const mappings = new Map([["PROD-001", mapping("PROD-001", "gid://shopify/Product/1")]]);
    // Shopify has the same SKU pointing to a different product
    const index = emptyIndex();
    index.skus.set("sku-001", { productId: "gid://shopify/Product/999", variantId: "gid://shopify/ProductVariant/999" });

    const { classifications } = classifyProducts({
      products: [product()],
      existingMappings: mappings,
      shopifyIndex: index,
    });

    // Persisted mapping should win over Shopify evidence
    expect(classifications[0].classification).toBe("EXISTING_MAPPED");
    expect(classifications[0].matchedShopifyProductId).toBe("gid://shopify/Product/1");
  });

  it("ignores persisted mapping with non-MAPPED status", () => {
    const unmapped: PersistedProductMapping = {
      ...mapping("PROD-001", "gid://shopify/Product/1"),
      mappingStatus: "UNMAPPED",
    };
    const mappings = new Map([["PROD-001", unmapped]]);

    const { classifications } = classifyProducts({
      products: [product()],
      existingMappings: mappings,
      shopifyIndex: emptyIndex(),
    });

    // Not MAPPED, so should fall through to evidence-based classification
    expect(classifications[0].classification).toBe("NEW_PRODUCT");
  });

  it("ignores persisted mapping without shopifyProductId", () => {
    const incomplete: PersistedProductMapping = {
      ...mapping("PROD-001", "gid://shopify/Product/1"),
      shopifyProductId: null,
    };
    const mappings = new Map([["PROD-001", incomplete]]);

    const { classifications } = classifyProducts({
      products: [product()],
      existingMappings: mappings,
      shopifyIndex: emptyIndex(),
    });

    expect(classifications[0].classification).toBe("NEW_PRODUCT");
  });
});

// ---------------------------------------------------------------------------
// Classification: Shopify evidence → LIKELY_EXISTING / NEEDS_REVIEW
// ---------------------------------------------------------------------------

describe("classifyProducts — Shopify bootstrap", () => {
  it("classifies as LIKELY_EXISTING with HIGH confidence when 2+ SKUs match same Shopify product", () => {
    const p = product({
      variants: [
        { sourceKey: "V1", sku: "SKU-A", options: {}, price: "10", sourceData: {} },
        { sourceKey: "V2", sku: "SKU-B", options: {}, price: "20", sourceData: {} },
      ],
    });
    const index = emptyIndex();
    index.skus.set("sku-a", { productId: "gid://P/1", variantId: "gid://V/1" });
    index.skus.set("sku-b", { productId: "gid://P/1", variantId: "gid://V/2" });

    const { classifications } = classifyProducts({
      products: [p],
      existingMappings: emptyMappings(),
      shopifyIndex: index,
    });

    expect(classifications[0].classification).toBe("LIKELY_EXISTING");
    expect(classifications[0].proposedAction).toBe("LINK_EXISTING_PRODUCT");
    expect(classifications[0].confidence).toBe("HIGH");
    expect(classifications[0].matchedShopifyProductId).toBe("gid://P/1");
  });

  it("classifies as LIKELY_EXISTING with HIGH confidence when single-variant product has 1 SKU match", () => {
    const p = product({
      variants: [
        { sourceKey: "V1", sku: "SKU-ONLY", options: {}, price: "10", sourceData: {} },
      ],
    });
    const index = emptyIndex();
    index.skus.set("sku-only", { productId: "gid://P/1", variantId: "gid://V/1" });

    const { classifications } = classifyProducts({
      products: [p],
      existingMappings: emptyMappings(),
      shopifyIndex: index,
    });

    // Single variant with 1 SKU match → HIGH confidence
    expect(classifications[0].classification).toBe("LIKELY_EXISTING");
    expect(classifications[0].confidence).toBe("HIGH");
  });

  it("classifies as NEEDS_REVIEW with MEDIUM confidence when multi-variant has only 1 SKU match", () => {
    const p = product({
      variants: [
        { sourceKey: "V1", sku: "SKU-MATCH", options: {}, price: "10", sourceData: {} },
        { sourceKey: "V2", sku: "SKU-NOMATCH", options: {}, price: "20", sourceData: {} },
        { sourceKey: "V3", sku: "SKU-ALSO-NO", options: {}, price: "30", sourceData: {} },
      ],
    });
    const index = emptyIndex();
    index.skus.set("sku-match", { productId: "gid://P/1", variantId: "gid://V/1" });

    const { classifications } = classifyProducts({
      products: [p],
      existingMappings: emptyMappings(),
      shopifyIndex: index,
    });

    expect(classifications[0].classification).toBe("NEEDS_REVIEW");
    expect(classifications[0].confidence).toBe("MEDIUM");
    expect(classifications[0].proposedAction).toBe("LINK_EXISTING_PRODUCT");
  });

  it("classifies as LIKELY_EXISTING when SKU + barcode match same product", () => {
    const p = product({
      variants: [
        { sourceKey: "V1", sku: "SKU-X", barcode: "BC-X", options: {}, price: "10", sourceData: {} },
      ],
    });
    const index = emptyIndex();
    index.skus.set("sku-x", { productId: "gid://P/1", variantId: "gid://V/1" });
    index.barcodes.set("bc-x", { productId: "gid://P/1", variantId: "gid://V/1" });

    const { classifications } = classifyProducts({
      products: [p],
      existingMappings: emptyMappings(),
      shopifyIndex: index,
    });

    expect(classifications[0].classification).toBe("LIKELY_EXISTING");
    expect(classifications[0].confidence).toBe("HIGH");
    expect(classifications[0].matchEvidence).toHaveLength(2);
  });

  it("classifies as NEEDS_REVIEW when evidence points to multiple Shopify products (ambiguous)", () => {
    const p = product({
      variants: [
        { sourceKey: "V1", sku: "SKU-A", options: {}, price: "10", sourceData: {} },
        { sourceKey: "V2", sku: "SKU-B", options: {}, price: "20", sourceData: {} },
      ],
    });
    const index = emptyIndex();
    index.skus.set("sku-a", { productId: "gid://P/1", variantId: "gid://V/1" });
    index.skus.set("sku-b", { productId: "gid://P/2", variantId: "gid://V/2" }); // different product!

    const { classifications } = classifyProducts({
      products: [p],
      existingMappings: emptyMappings(),
      shopifyIndex: index,
    });

    expect(classifications[0].classification).toBe("NEEDS_REVIEW");
    expect(classifications[0].confidence).toBe("LOW");
    expect(classifications[0].proposedAction).toBe("SKIP");
    expect(classifications[0].matchedShopifyProductId).toBeNull(); // ambiguous
  });

  it("barcode-only match for single-variant product → HIGH confidence", () => {
    const p = product({
      variants: [
        { sourceKey: "V1", barcode: "0123456789", options: {}, price: "10", sourceData: {} },
      ],
    });
    const index = emptyIndex();
    index.barcodes.set("0123456789", { productId: "gid://P/1", variantId: "gid://V/1" });

    const { classifications } = classifyProducts({
      products: [p],
      existingMappings: emptyMappings(),
      shopifyIndex: index,
    });

    expect(classifications[0].classification).toBe("LIKELY_EXISTING");
    expect(classifications[0].confidence).toBe("HIGH");
  });
});

// ---------------------------------------------------------------------------
// Classification: no match → NEW_PRODUCT
// ---------------------------------------------------------------------------

describe("classifyProducts — new product", () => {
  it("classifies as NEW_PRODUCT when no mapping and no Shopify evidence", () => {
    const { classifications, summary } = classifyProducts({
      products: [product()],
      existingMappings: emptyMappings(),
      shopifyIndex: emptyIndex(),
    });

    expect(classifications[0].classification).toBe("NEW_PRODUCT");
    expect(classifications[0].proposedAction).toBe("CREATE_PRODUCT");
    expect(classifications[0].matchedShopifyProductId).toBeNull();
    expect(classifications[0].confidence).toBeNull();
    expect(classifications[0].matchEvidence).toHaveLength(0);
    expect(summary.newProducts).toBe(1);
  });

  it("classifies product with no SKU/barcode as NEW_PRODUCT even when Shopify has title match", () => {
    const p = product({
      title: "Matching Title",
      variants: [{ sourceKey: "V1", options: {}, price: "10", sourceData: {} }], // no SKU, no barcode
    });
    const index = emptyIndex();
    index.titles.set("matching title", "gid://P/1");

    const { classifications } = classifyProducts({
      products: [p],
      existingMappings: emptyMappings(),
      shopifyIndex: index,
    });

    // Title alone MUST NOT establish identity — spec invariant
    expect(classifications[0].classification).toBe("NEW_PRODUCT");
  });
});

// ---------------------------------------------------------------------------
// Title never auto-links (spec invariant)
// ---------------------------------------------------------------------------

describe("classifyProducts — title never auto-links", () => {
  it("does not use title as evidence even when Shopify title matches exactly", () => {
    const p = product({ title: "Exact Match Product" });
    const index = emptyIndex();
    index.titles.set("exact match product", "gid://P/1");
    // No SKU or barcode matches

    const { classifications } = classifyProducts({
      products: [p],
      existingMappings: emptyMappings(),
      shopifyIndex: index,
    });

    // Title is in the index but the engine must not use it
    expect(classifications[0].matchEvidence).toHaveLength(0);
    expect(classifications[0].classification).toBe("NEW_PRODUCT");
  });
});

// ---------------------------------------------------------------------------
// Summary counts
// ---------------------------------------------------------------------------

describe("classifyProducts — summary", () => {
  it("computes correct summary for mixed classifications", () => {
    const products = [
      product({ sourceKey: "MAPPED-1" }),
      product({ sourceKey: "NEW-1" }),
      product({ sourceKey: "NEW-2" }),
      product({
        sourceKey: "REVIEW-1",
        variants: [
          { sourceKey: "V1", sku: "R-SKU-A", options: {}, price: "10", sourceData: {} },
          { sourceKey: "V2", sku: "R-SKU-B", options: {}, price: "20", sourceData: {} },
        ],
      }),
    ];

    const mappings = new Map([["MAPPED-1", mapping("MAPPED-1", "gid://P/1")]]);
    const index = emptyIndex();
    // REVIEW-1: SKUs point to different products → ambiguous
    index.skus.set("r-sku-a", { productId: "gid://P/10", variantId: "gid://V/10" });
    index.skus.set("r-sku-b", { productId: "gid://P/11", variantId: "gid://V/11" });

    const { summary } = classifyProducts({
      products,
      existingMappings: mappings,
      shopifyIndex: index,
    });

    expect(summary.totalProducts).toBe(4);
    expect(summary.existingMapped).toBe(1);
    expect(summary.newProducts).toBe(2);
    expect(summary.needsReview).toBe(1);
    expect(summary.likelyExisting).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

describe("classifyProducts — edge cases", () => {
  it("handles empty product list", () => {
    const { classifications, summary } = classifyProducts({
      products: [],
      existingMappings: emptyMappings(),
      shopifyIndex: emptyIndex(),
    });

    expect(classifications).toHaveLength(0);
    expect(summary.totalProducts).toBe(0);
  });

  it("handles variant with empty/whitespace SKU — not treated as evidence", () => {
    const p = product({
      variants: [{ sourceKey: "V1", sku: "   ", options: {}, price: "10", sourceData: {} }],
    });
    const index = emptyIndex();
    index.skus.set("   ", { productId: "gid://P/1", variantId: "gid://V/1" });

    const { classifications } = classifyProducts({
      products: [p],
      existingMappings: emptyMappings(),
      shopifyIndex: index,
    });

    // Whitespace-only SKU should not produce evidence
    expect(classifications[0].classification).toBe("NEW_PRODUCT");
    expect(classifications[0].matchEvidence).toHaveLength(0);
  });
});
