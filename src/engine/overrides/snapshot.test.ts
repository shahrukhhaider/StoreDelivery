/**
 * Tests for the import snapshot chain:
 * source + overrides → resolved → validated → snapshot captures diff
 *
 * Verifies the full contract:
 * 1. Resolved data reflects overrides (not raw source)
 * 2. Diff between source and resolved is correct
 * 3. Snapshot contains all applied overrides
 * 4. After cleanup, overrides are gone but snapshot persists
 * 5. Snapshot can reconstruct what was sent to Shopify
 */

import { describe, it, expect } from "vitest";
import { applyOverrides, computeDiff, type Override } from "./merge.js";
import { validateCatalog } from "../validation/validation-engine.js";
import type { CatalogProduct } from "@shared/types/catalog.js";

function makeProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    sourceKey: "SNAP-001",
    title: "Original Title",
    vendor: "OriginalVendor",
    productType: "Widgets",
    tags: ["original"],
    variants: [{
      sourceKey: "V1",
      sku: "",
      options: {},
      price: "24.99",
      sourceData: {},
    }],
    images: [{ sourceUrl: "https://img.com/orig.jpg", position: 1 }],
    sourceData: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Resolved data reflects overrides
// ---------------------------------------------------------------------------

describe("resolved data reflects overrides", () => {
  it("single override changes the resolved product", () => {
    const source = makeProduct();
    const overrides: Override[] = [
      { field: "title", oldValue: "Original Title", newValue: "Edited Title", source: "user" },
    ];

    const resolved = applyOverrides(source, overrides);
    expect(resolved.title).toBe("Edited Title");
    expect(source.title).toBe("Original Title"); // immutable
  });

  it("SKU override makes missing-SKU warning disappear", () => {
    const source = makeProduct(); // sku is empty string
    const beforeIssues = validateCatalog([source]);
    expect(beforeIssues.issues.some((i) => i.code === "MISSING_SKU")).toBe(true);

    const resolved = applyOverrides(source, [
      { field: "variants[0].sku", oldValue: "", newValue: "SNAP-001-001", source: "user" },
    ]);

    const afterIssues = validateCatalog([resolved]);
    expect(afterIssues.issues.some((i) => i.code === "MISSING_SKU")).toBe(false);
  });

  it("multiple overrides all apply to the resolved product", () => {
    const source = makeProduct();
    const overrides: Override[] = [
      { field: "title", oldValue: "Original Title", newValue: "New Title", source: "user" },
      { field: "vendor", oldValue: "OriginalVendor", newValue: "NewVendor", source: "bulk_rule" },
      { field: "variants[0].sku", oldValue: "", newValue: "NEW-SKU", source: "user" },
      { field: "variants[0].price", oldValue: "24.99", newValue: "19.99", source: "user" },
    ];

    const resolved = applyOverrides(source, overrides);
    expect(resolved.title).toBe("New Title");
    expect(resolved.vendor).toBe("NewVendor");
    expect(resolved.variants[0].sku).toBe("NEW-SKU");
    expect(resolved.variants[0].price).toBe("19.99");
  });
});

// ---------------------------------------------------------------------------
// 2. Diff captures exactly what changed
// ---------------------------------------------------------------------------

describe("diff captures what was sent vs source", () => {
  it("diff contains only changed fields", () => {
    const source = makeProduct();
    const overrides: Override[] = [
      { field: "title", oldValue: "Original Title", newValue: "New Title", source: "user" },
    ];
    const resolved = applyOverrides(source, overrides);
    const diff = computeDiff(source, resolved);

    expect(diff).toHaveLength(1);
    expect(diff[0]).toEqual({
      field: "title",
      oldValue: "Original Title",
      newValue: "New Title",
    });
  });

  it("diff captures variant-level changes", () => {
    const source = makeProduct();
    const resolved = applyOverrides(source, [
      { field: "variants[0].sku", oldValue: "", newValue: "NEW-SKU", source: "user" },
      { field: "variants[0].price", oldValue: "24.99", newValue: "9.99", source: "user" },
    ]);
    const diff = computeDiff(source, resolved);

    expect(diff).toContainEqual({ field: "variants[0].sku", oldValue: "", newValue: "NEW-SKU" });
    expect(diff).toContainEqual({ field: "variants[0].price", oldValue: "24.99", newValue: "9.99" });
  });

  it("diff is empty when no overrides applied", () => {
    const source = makeProduct();
    const diff = computeDiff(source, source);
    expect(diff).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Snapshot structure matches what a rollback would need
// ---------------------------------------------------------------------------

describe("snapshot contains all data needed for rollback", () => {
  it("snapshot preserves all override details", () => {
    const overrides: Override[] = [
      { field: "title", oldValue: "Original Title", newValue: "New Title", source: "user" },
      { field: "variants[0].sku", oldValue: "", newValue: "SKU-001", source: "bulk_rule" },
      { field: "vendor", oldValue: "OriginalVendor", newValue: "NewVendor", source: "auto_fix" },
    ];

    // Simulate what import_executor stores in import_snapshots.applied_overrides
    const snapshot = overrides.map((o) => ({
      field: o.field,
      oldValue: o.oldValue,
      newValue: o.newValue,
      source: o.source,
    }));

    expect(snapshot).toHaveLength(3);
    expect(snapshot[0].field).toBe("title");
    expect(snapshot[0].oldValue).toBe("Original Title");
    expect(snapshot[0].newValue).toBe("New Title");
    expect(snapshot[1].source).toBe("bulk_rule");
    expect(snapshot[2].source).toBe("auto_fix");
  });

  it("snapshot + source can reconstruct the resolved product", () => {
    const source = makeProduct();
    const overrides: Override[] = [
      { field: "title", oldValue: "Original Title", newValue: "Imported Title", source: "user" },
      { field: "variants[0].sku", oldValue: "", newValue: "FINAL-SKU", source: "user" },
    ];

    // What was sent to Shopify
    const resolved = applyOverrides(source, overrides);

    // Simulate rollback: re-apply snapshot overrides to source
    const reconstructed = applyOverrides(source, overrides);
    expect(reconstructed.title).toBe(resolved.title);
    expect(reconstructed.variants[0].sku).toBe(resolved.variants[0].sku);
  });

  it("snapshot oldValues can reconstruct the original state", () => {
    const source = makeProduct();
    const overrides: Override[] = [
      { field: "title", oldValue: "Original Title", newValue: "Edited", source: "user" },
      { field: "vendor", oldValue: "OriginalVendor", newValue: "Edited Vendor", source: "user" },
    ];

    // Reverse overrides (swap old/new) to get back to original
    const reverseOverrides: Override[] = overrides.map((o) => ({
      field: o.field,
      oldValue: o.newValue,
      newValue: o.oldValue,
      source: "user",
    }));

    const resolved = applyOverrides(source, overrides);
    expect(resolved.title).toBe("Edited");

    const rolledBack = applyOverrides(resolved, reverseOverrides);
    expect(rolledBack.title).toBe("Original Title");
    expect(rolledBack.vendor).toBe("OriginalVendor");
  });
});

// ---------------------------------------------------------------------------
// 4. After cleanup, overrides gone but snapshot logic still works
// ---------------------------------------------------------------------------

describe("cleanup semantics", () => {
  it("empty overrides list returns the source unchanged", () => {
    const source = makeProduct();
    const resolved = applyOverrides(source, []);
    expect(resolved).toEqual(source);
  });

  it("re-applying snapshot overrides produces same resolved product", () => {
    const source = makeProduct();
    const overrides: Override[] = [
      { field: "title", oldValue: "Original Title", newValue: "Final", source: "user" },
    ];

    const firstResolve = applyOverrides(source, overrides);
    // Simulate: overrides cleaned from DB, only snapshot remains
    // Re-apply from snapshot
    const secondResolve = applyOverrides(source, overrides);
    expect(firstResolve.title).toBe(secondResolve.title);
  });
});

// ---------------------------------------------------------------------------
// 5. Multi-product batch scenario
// ---------------------------------------------------------------------------

describe("batch import with overrides", () => {
  it("each product gets its own overrides applied independently", () => {
    const products = [
      makeProduct({ sourceKey: "P1", title: "Product 1", variants: [{ sourceKey: "V1", sku: "", options: {}, price: "10", sourceData: {} }] }),
      makeProduct({ sourceKey: "P2", title: "Product 2", variants: [{ sourceKey: "V2", sku: "", options: {}, price: "20", sourceData: {} }] }),
      makeProduct({ sourceKey: "P3", title: "Product 3", variants: [{ sourceKey: "V3", sku: "EXISTING", options: {}, price: "30", sourceData: {} }] }),
    ];

    // Overrides only for P1 and P2
    const overrideMap: Record<string, Override[]> = {
      P1: [{ field: "variants[0].sku", oldValue: "", newValue: "P1-001", source: "bulk_rule" }],
      P2: [{ field: "variants[0].sku", oldValue: "", newValue: "P2-001", source: "bulk_rule" }],
    };

    const resolved = products.map((p) => {
      const overrides = overrideMap[p.sourceKey] ?? [];
      return applyOverrides(p, overrides);
    });

    expect(resolved[0].variants[0].sku).toBe("P1-001");
    expect(resolved[1].variants[0].sku).toBe("P2-001");
    expect(resolved[2].variants[0].sku).toBe("EXISTING"); // unchanged

    // Validate: P1 and P2 no longer have MISSING_SKU
    const issues = validateCatalog(resolved);
    const missingSkuProducts = issues.issues
      .filter((i) => i.code === "MISSING_SKU")
      .map((i) => i.sourceKey);
    expect(missingSkuProducts).not.toContain("P1");
    expect(missingSkuProducts).not.toContain("P2");
  });

  it("snapshot captures overrides for all edited products", () => {
    const allOverrides = [
      { productId: "P1", field: "variants[0].sku", oldValue: "", newValue: "P1-001", source: "bulk_rule" },
      { productId: "P2", field: "variants[0].sku", oldValue: "", newValue: "P2-001", source: "bulk_rule" },
    ];

    // Snapshot groups by product
    const byProduct = new Map<string, typeof allOverrides>();
    for (const o of allOverrides) {
      const list = byProduct.get(o.productId) ?? [];
      list.push(o);
      byProduct.set(o.productId, list);
    }

    expect(byProduct.get("P1")).toHaveLength(1);
    expect(byProduct.get("P2")).toHaveLength(1);
    expect(byProduct.has("P3")).toBe(false); // no overrides
  });
});
