import { describe, it, expect } from "vitest";
import { computeVariantFingerprint, computeProductFingerprints } from "./variant-fingerprint.js";
import type { CatalogVariant } from "@shared/types/catalog.js";

function variant(overrides: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    sourceKey: "PROD-001",
    options: {},
    sourceData: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Priority chain
// ---------------------------------------------------------------------------

describe("computeVariantFingerprint — priority chain", () => {
  it("priority 1: uses explicit variant sourceKey when it differs from product key", () => {
    const v = variant({ sourceKey: "SUPPLIER-VAR-99" });
    const fp = computeVariantFingerprint("PROD-001", v, 0);
    expect(fp).toBe("supplier-var-99");
  });

  it("priority 2: uses supplier SKU when sourceKey matches product key", () => {
    const v = variant({ sourceKey: "PROD-001", sku: "SKU-RED-M" });
    const fp = computeVariantFingerprint("PROD-001", v, 0);
    expect(fp).toBe("sku:sku-red-m");
  });

  it("priority 3: uses barcode when no explicit key or SKU", () => {
    const v = variant({ sourceKey: "PROD-001", barcode: "0123456789" });
    const fp = computeVariantFingerprint("PROD-001", v, 0);
    expect(fp).toBe("barcode:0123456789");
  });

  it("priority 4: derives fingerprint from options when no key/sku/barcode", () => {
    const v = variant({
      sourceKey: "PROD-001",
      options: { Color: "Red", Size: "Medium" },
    });
    const fp = computeVariantFingerprint("PROD-001", v, 0);
    expect(fp).toBe("prod-001|color=red|size=medium");
  });

  it("priority 5: falls back to product key + index when nothing else", () => {
    const v = variant({ sourceKey: "PROD-001" });
    const fp = computeVariantFingerprint("PROD-001", v, 3);
    expect(fp).toBe("prod-001|#3");
  });
});

// ---------------------------------------------------------------------------
// Generated SKU exclusion
// ---------------------------------------------------------------------------

describe("computeVariantFingerprint — generated SKU exclusion", () => {
  it("does NOT use a STOREDELIVERY_GENERATED SKU as identity", () => {
    const v = variant({
      sourceKey: "PROD-001",
      sku: "prod-001-001",
      skuSource: "STOREDELIVERY_GENERATED",
      options: { Color: "Blue" },
    });
    const fp = computeVariantFingerprint("PROD-001", v, 0);
    // Should fall through to options, not use the generated SKU
    expect(fp).not.toContain("prod-001-001");
    expect(fp).toBe("prod-001|color=blue");
  });

  it("uses SUPPLIER SKU as identity", () => {
    const v = variant({
      sourceKey: "PROD-001",
      sku: "SUP-42",
      skuSource: "SUPPLIER",
    });
    const fp = computeVariantFingerprint("PROD-001", v, 0);
    expect(fp).toBe("sku:sup-42");
  });

  it("uses MERCHANT SKU as identity (not generated)", () => {
    const v = variant({
      sourceKey: "PROD-001",
      sku: "MERCH-SKU-1",
      skuSource: "MERCHANT",
    });
    const fp = computeVariantFingerprint("PROD-001", v, 0);
    expect(fp).toBe("sku:merch-sku-1");
  });

  it("uses SKU when skuSource is undefined (defaults to supplier)", () => {
    const v = variant({ sourceKey: "PROD-001", sku: "MY-SKU" });
    const fp = computeVariantFingerprint("PROD-001", v, 0);
    expect(fp).toBe("sku:my-sku");
  });
});

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

describe("computeVariantFingerprint — normalization", () => {
  it("normalizes to lowercase", () => {
    const v = variant({ sourceKey: "VAR-ABC" });
    const fp = computeVariantFingerprint("PROD", v, 0);
    expect(fp).toBe("var-abc");
  });

  it("trims whitespace", () => {
    const v = variant({ sourceKey: "  VAR-1  " });
    const fp = computeVariantFingerprint("PROD", v, 0);
    expect(fp).toBe("var-1");
  });

  it("normalizes option keys: lowercases and replaces spaces with underscores", () => {
    const v = variant({
      sourceKey: "PROD-001",
      options: { "  Option Name  ": "Value" },
    });
    const fp = computeVariantFingerprint("PROD-001", v, 0);
    expect(fp).toContain("option_name=value");
  });

  it("sorts options deterministically", () => {
    const v1 = variant({
      sourceKey: "P",
      options: { Size: "M", Color: "Red" },
    });
    const v2 = variant({
      sourceKey: "P",
      options: { Color: "Red", Size: "M" },
    });
    expect(computeVariantFingerprint("P", v1, 0)).toBe(
      computeVariantFingerprint("P", v2, 0),
    );
  });

  it("filters out empty option values", () => {
    const v = variant({
      sourceKey: "PROD-001",
      options: { Color: "Red", Size: "" },
    });
    const fp = computeVariantFingerprint("PROD-001", v, 0);
    expect(fp).toBe("prod-001|color=red");
    expect(fp).not.toContain("size");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("computeVariantFingerprint — edge cases", () => {
  it("handles variant with empty sourceKey (falls to options or index)", () => {
    const v = variant({ sourceKey: "", options: { Color: "Green" } });
    const fp = computeVariantFingerprint("PROD", v, 0);
    expect(fp).toBe("prod|color=green");
  });

  it("handles whitespace-only sourceKey the same as empty", () => {
    const v = variant({ sourceKey: "   " });
    const fp = computeVariantFingerprint("PROD", v, 5);
    expect(fp).toBe("prod|#5");
  });

  it("handles whitespace-only SKU by ignoring it", () => {
    const v = variant({ sourceKey: "PROD", sku: "   " });
    const fp = computeVariantFingerprint("PROD", v, 0);
    expect(fp).toBe("prod|#0");
  });
});

// ---------------------------------------------------------------------------
// computeProductFingerprints
// ---------------------------------------------------------------------------

describe("computeProductFingerprints", () => {
  it("computes fingerprints for all variants", () => {
    const variants: CatalogVariant[] = [
      { sourceKey: "V1", sku: "SKU-A", options: {}, sourceData: {} },
      { sourceKey: "V2", sku: "SKU-B", options: {}, sourceData: {} },
    ];
    const fps = computeProductFingerprints("PROD", variants);
    expect(fps).toHaveLength(2);
    expect(fps[0]).toBe("v1");
    expect(fps[1]).toBe("v2");
  });

  it("passes correct variant index to each call", () => {
    // Two variants with same product key and no distinguishing features
    // except index → they should get different fingerprints
    const variants: CatalogVariant[] = [
      { sourceKey: "PROD", options: {}, sourceData: {} },
      { sourceKey: "PROD", options: {}, sourceData: {} },
    ];
    const fps = computeProductFingerprints("PROD", variants);
    expect(fps[0]).toBe("prod|#0");
    expect(fps[1]).toBe("prod|#1");
    expect(fps[0]).not.toBe(fps[1]);
  });
});
