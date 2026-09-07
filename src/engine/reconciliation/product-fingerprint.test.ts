import { describe, it, expect } from "vitest";
import { computeProductFingerprint, computeProductFingerprints } from "./product-fingerprint.js";
import type { CatalogProduct } from "@shared/types/catalog.js";

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    sourceKey: "Classic-Tee",
    title: "Classic Tee",
    tags: [],
    variants: [],
    images: [],
    sourceData: {},
    ...overrides,
  };
}

describe("computeProductFingerprint", () => {
  it("normalizes sourceKey to lowercase", () => {
    expect(computeProductFingerprint(product({ sourceKey: "CLASSIC-TEE" }))).toBe("classic-tee");
  });

  it("trims whitespace", () => {
    expect(computeProductFingerprint(product({ sourceKey: "  Classic-Tee  " }))).toBe("classic-tee");
  });

  it("produces the same fingerprint regardless of title/vendor changes", () => {
    const fp1 = computeProductFingerprint(product({ title: "Classic Tee" }));
    const fp2 = computeProductFingerprint(product({ title: "Updated Tee Name" }));
    expect(fp1).toBe(fp2); // sourceKey is the identity, not title
  });

  it("produces different fingerprints for different sourceKeys", () => {
    const fp1 = computeProductFingerprint(product({ sourceKey: "A" }));
    const fp2 = computeProductFingerprint(product({ sourceKey: "B" }));
    expect(fp1).not.toBe(fp2);
  });

  it("is deterministic across calls", () => {
    const p = product();
    expect(computeProductFingerprint(p)).toBe(computeProductFingerprint(p));
  });
});

describe("computeProductFingerprints", () => {
  it("returns a map of sourceKey → fingerprint", () => {
    const products = [
      product({ sourceKey: "A" }),
      product({ sourceKey: "B" }),
    ];
    const fps = computeProductFingerprints(products);
    expect(fps.size).toBe(2);
    expect(fps.get("A")).toBe("a");
    expect(fps.get("B")).toBe("b");
  });

  it("handles empty list", () => {
    const fps = computeProductFingerprints([]);
    expect(fps.size).toBe(0);
  });
});
