/**
 * Integration tests for the override system — end-to-end flows
 * that simulate real merchant editing scenarios.
 */

import { describe, it, expect } from "vitest";
import { applyOverrides, computeDiff, type Override } from "./merge.js";
import { detectAutoFixes, detectAllAutoFixes } from "./auto-fix.js";
import { classifyIssueType, filterIssues, getAffectedKeys } from "./issue-filter.js";
import { validateCatalog } from "../validation/validation-engine.js";
import type { CatalogProduct, CatalogIssue } from "@shared/types/catalog.js";

function makeProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    sourceKey: "TEST-001",
    title: "Test Product",
    vendor: "TestVendor",
    productType: "Widgets",
    tags: ["tag1"],
    variants: [{
      sourceKey: "V1",
      sku: "SKU-001",
      options: {},
      price: "24.99",
      sourceData: {},
    }],
    images: [{ sourceUrl: "https://img.com/test.jpg", position: 1 }],
    sourceData: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Override → Validation flow (edit fixes a blocking issue)
// ---------------------------------------------------------------------------

describe("override fixes blocking issues", () => {
  it("fixing missing title resolves the blocking issue", () => {
    const product = makeProduct({ title: "" });

    // Before: has blocking issue
    const beforeValidation = validateCatalog([product]);
    expect(beforeValidation.blockingCount).toBe(1);
    expect(beforeValidation.issues[0].code).toBe("MISSING_TITLE");

    // Apply override to fix title
    const fixed = applyOverrides(product, [
      { field: "title", oldValue: "", newValue: "Fixed Title", source: "user" },
    ]);

    // After: no blocking issues
    const afterValidation = validateCatalog([fixed]);
    expect(afterValidation.blockingCount).toBe(0);
    expect(fixed.title).toBe("Fixed Title");
  });

  it("fixing malformed price resolves the blocking issue", () => {
    const product = makeProduct({
      variants: [{
        sourceKey: "V1",
        sku: "A",
        options: {},
        price: "not-a-number",
        sourceData: {},
      }],
    });

    const before = validateCatalog([product]);
    expect(before.blockingCount).toBe(1);

    const fixed = applyOverrides(product, [
      { field: "variants[0].price", oldValue: "not-a-number", newValue: "29.99", source: "user" },
    ]);

    const after = validateCatalog([fixed]);
    expect(after.blockingCount).toBe(0);
    expect(fixed.variants[0].price).toBe("29.99");
  });
});

// ---------------------------------------------------------------------------
// Auto-fix → Validation flow
// ---------------------------------------------------------------------------

describe("auto-fix cleans up warnings", () => {
  it("auto-fix trims whitespace that normalizer missed", () => {
    const product = makeProduct({
      title: "  Widget Pro  ",
      vendor: " Acme ",
      variants: [{
        sourceKey: "V1",
        sku: " SKU-001 ",
        options: {},
        price: "$29.99",
        sourceData: {},
      }],
    });

    const fixes = detectAutoFixes(product);
    expect(fixes.length).toBeGreaterThanOrEqual(3); // title, vendor, sku, price

    const resolved = applyOverrides(product, fixes);
    expect(resolved.title).toBe("Widget Pro");
    expect(resolved.vendor).toBe("Acme");
    expect(resolved.variants[0].sku).toBe("SKU-001");
    expect(resolved.variants[0].price).toBe("29.99");
  });

  it("auto-fix preserves original data in override oldValue", () => {
    const product = makeProduct({ title: "  Needs Trim  " });
    const fixes = detectAutoFixes(product);
    const titleFix = fixes.find((f) => f.field === "title");
    expect(titleFix?.oldValue).toBe("  Needs Trim  ");
    expect(titleFix?.newValue).toBe("Needs Trim");
  });
});

// ---------------------------------------------------------------------------
// Multiple overrides on same product
// ---------------------------------------------------------------------------

describe("multiple overrides stack correctly", () => {
  it("later overrides on same field win", () => {
    const product = makeProduct({ title: "Original" });
    const resolved = applyOverrides(product, [
      { field: "title", oldValue: "Original", newValue: "First Edit", source: "user" },
      { field: "title", oldValue: "First Edit", newValue: "Second Edit", source: "user" },
    ]);
    expect(resolved.title).toBe("Second Edit");
  });

  it("overrides on different fields are independent", () => {
    const product = makeProduct({ title: "Original", vendor: "OldVendor" });
    const resolved = applyOverrides(product, [
      { field: "title", oldValue: "Original", newValue: "New Title", source: "user" },
      { field: "vendor", oldValue: "OldVendor", newValue: "New Vendor", source: "bulk_rule" },
    ]);
    expect(resolved.title).toBe("New Title");
    expect(resolved.vendor).toBe("New Vendor");
  });

  it("mixing auto_fix and user overrides works", () => {
    const product = makeProduct({
      title: "  Messy  ",
      vendor: "OldVendor",
    });

    const autoFixes = detectAutoFixes(product);
    const userOverrides: Override[] = [
      { field: "vendor", oldValue: "OldVendor", newValue: "BetterVendor", source: "user" },
    ];

    const resolved = applyOverrides(product, [...autoFixes, ...userOverrides]);
    expect(resolved.title).toBe("Messy"); // auto-fixed whitespace
    expect(resolved.vendor).toBe("BetterVendor"); // user edit
  });
});

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

describe("diff captures all changes for import snapshot", () => {
  it("captures title + variant price change", () => {
    const original = makeProduct();
    const resolved = applyOverrides(original, [
      { field: "title", oldValue: "Test Product", newValue: "New Name", source: "user" },
      { field: "variants[0].price", oldValue: "24.99", newValue: "19.99", source: "user" },
    ]);

    const diff = computeDiff(original, resolved);
    expect(diff).toContainEqual({ field: "title", oldValue: "Test Product", newValue: "New Name" });
    expect(diff).toContainEqual({ field: "variants[0].price", oldValue: "24.99", newValue: "19.99" });
  });

  it("empty diff when no overrides applied", () => {
    const product = makeProduct();
    const diff = computeDiff(product, product);
    expect(diff).toHaveLength(0);
  });

  it("diff only includes changed fields", () => {
    const original = makeProduct();
    const resolved = applyOverrides(original, [
      { field: "vendor", oldValue: "TestVendor", newValue: "NewVendor", source: "user" },
    ]);

    const diff = computeDiff(original, resolved);
    expect(diff).toHaveLength(1);
    expect(diff[0].field).toBe("vendor");
  });
});

// ---------------------------------------------------------------------------
// Issue filtering after overrides
// ---------------------------------------------------------------------------

describe("issue filtering reflects override state", () => {
  it("fixing a product removes it from the affected keys", () => {
    const products = [
      makeProduct({ sourceKey: "P1", title: "" }),
      makeProduct({ sourceKey: "P2", title: "" }),
      makeProduct({ sourceKey: "P3", title: "Has Title" }),
    ];

    // Before fix: P1 and P2 are affected
    const beforeIssues = validateCatalog(products).issues;
    const beforeKeys = getAffectedKeys(beforeIssues, { type: "missing_value" });
    expect(beforeKeys.has("P1")).toBe(true);
    expect(beforeKeys.has("P2")).toBe(true);

    // Fix P1's title
    const fixedProducts = [...products];
    fixedProducts[0] = applyOverrides(products[0], [
      { field: "title", oldValue: "", newValue: "Fixed", source: "user" },
    ]);

    // After fix: only P2 is affected
    const afterIssues = validateCatalog(fixedProducts).issues;
    const afterKeys = getAffectedKeys(afterIssues, { type: "missing_value" });
    expect(afterKeys.has("P1")).toBe(false);
    expect(afterKeys.has("P2")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Batch auto-fix summary
// ---------------------------------------------------------------------------

describe("batch auto-fix produces correct summary", () => {
  it("counts by fix type across multiple products", () => {
    const products = [
      makeProduct({ title: "  Messy Title  ", sourceKey: "P1" }),
      makeProduct({
        sourceKey: "P2",
        variants: [{ sourceKey: "V1", sku: "A", options: {}, price: "$15.00", sourceData: {} }],
      }),
      makeProduct({ sourceKey: "P3" }), // clean
    ];

    const summary = detectAllAutoFixes(products);
    expect(summary.totalFixed).toBeGreaterThanOrEqual(2);
    expect(summary.totalSkipped).toBe(1); // P3 is clean
    expect(summary.breakdown).toHaveProperty("whitespace_normalization");
    expect(summary.breakdown).toHaveProperty("currency_cleanup");
  });
});
