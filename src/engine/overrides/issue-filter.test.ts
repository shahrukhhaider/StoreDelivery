import { describe, it, expect } from "vitest";
import {
  classifyIssueType,
  filterIssues,
  getAffectedKeys,
  countIssues,
} from "./issue-filter.js";
import type { CatalogIssue } from "@shared/types/catalog.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_ISSUES: CatalogIssue[] = [
  { severity: "blocking", code: "MISSING_TITLE", message: "Product is missing a title", sourceKey: "P1", field: "title" },
  { severity: "blocking", code: "NO_VARIANTS", message: "Product has no variants", sourceKey: "P2", field: "variants" },
  { severity: "warning", code: "MISSING_SKU", message: "Variant is missing a SKU", sourceKey: "P3", field: "sku" },
  { severity: "warning", code: "MISSING_SKU", message: "Variant is missing a SKU", sourceKey: "P4", field: "sku" },
  { severity: "warning", code: "DUPLICATE_SKU", message: "SKU appears in 2 products", field: "sku" },
  { severity: "warning", code: "DUPLICATE_BARCODE", message: "Barcode appears in 2 products", field: "barcode" },
  { severity: "warning", code: "SUSPICIOUS_HIGH_PRICE", message: "Price seems high", sourceKey: "P5", field: "price" },
  { severity: "warning", code: "INVALID_IMAGE_URL", message: "Image URL invalid", sourceKey: "P6", field: "image" },
  { severity: "warning", code: "EMPTY_OPTION", message: "Empty option value", sourceKey: "P7", field: "Color" },
  { severity: "blocking", code: "MALFORMED_PRICE", message: "Price cannot be parsed", sourceKey: "P8", field: "price" },
];

// ---------------------------------------------------------------------------
// classifyIssueType
// ---------------------------------------------------------------------------

describe("classifyIssueType", () => {
  it("classifies MISSING_TITLE as missing_value", () => {
    expect(classifyIssueType("MISSING_TITLE")).toBe("missing_value");
  });

  it("classifies MISSING_SKU as missing_value", () => {
    expect(classifyIssueType("MISSING_SKU")).toBe("missing_value");
  });

  it("classifies DUPLICATE_SKU as duplicate", () => {
    expect(classifyIssueType("DUPLICATE_SKU")).toBe("duplicate");
  });

  it("classifies DUPLICATE_BARCODE as duplicate", () => {
    expect(classifyIssueType("DUPLICATE_BARCODE")).toBe("duplicate");
  });

  it("classifies MALFORMED_PRICE as invalid_value", () => {
    expect(classifyIssueType("MALFORMED_PRICE")).toBe("invalid_value");
  });

  it("classifies SUSPICIOUS_HIGH_PRICE as invalid_value", () => {
    expect(classifyIssueType("SUSPICIOUS_HIGH_PRICE")).toBe("invalid_value");
  });

  it("classifies SUSPICIOUS_LOW_PRICE as invalid_value", () => {
    expect(classifyIssueType("SUSPICIOUS_LOW_PRICE")).toBe("invalid_value");
  });

  it("classifies INVALID_IMAGE_URL as image", () => {
    expect(classifyIssueType("INVALID_IMAGE_URL")).toBe("image");
  });

  it("classifies NO_VARIANTS as variant_grouping", () => {
    expect(classifyIssueType("NO_VARIANTS")).toBe("variant_grouping");
  });

  it("classifies EMPTY_OPTION as variant_grouping", () => {
    expect(classifyIssueType("EMPTY_OPTION")).toBe("variant_grouping");
  });

  it("classifies NO_PRODUCTS as other", () => {
    expect(classifyIssueType("NO_PRODUCTS")).toBe("other");
  });

  it("classifies unknown codes as other", () => {
    expect(classifyIssueType("SOME_RANDOM_CODE")).toBe("other");
  });
});

// ---------------------------------------------------------------------------
// filterIssues
// ---------------------------------------------------------------------------

describe("filterIssues", () => {
  it("returns all issues with no filters", () => {
    expect(filterIssues(SAMPLE_ISSUES, {})).toHaveLength(10);
  });

  it("filters by severity: blocking", () => {
    const result = filterIssues(SAMPLE_ISSUES, { severity: "blocking" });
    expect(result.every((i) => i.severity === "blocking")).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("filters by severity: warning", () => {
    const result = filterIssues(SAMPLE_ISSUES, { severity: "warning" });
    expect(result.every((i) => i.severity === "warning")).toBe(true);
    expect(result).toHaveLength(7);
  });

  it("filters by type: missing_value", () => {
    const result = filterIssues(SAMPLE_ISSUES, { type: "missing_value" });
    expect(result).toHaveLength(3); // MISSING_TITLE + 2x MISSING_SKU
  });

  it("filters by type: duplicate", () => {
    const result = filterIssues(SAMPLE_ISSUES, { type: "duplicate" });
    expect(result).toHaveLength(2); // DUPLICATE_SKU + DUPLICATE_BARCODE
  });

  it("filters by type: invalid_value", () => {
    const result = filterIssues(SAMPLE_ISSUES, { type: "invalid_value" });
    expect(result).toHaveLength(2); // SUSPICIOUS_HIGH_PRICE + MALFORMED_PRICE
  });

  it("filters by type: image", () => {
    const result = filterIssues(SAMPLE_ISSUES, { type: "image" });
    expect(result).toHaveLength(1);
  });

  it("filters by type: variant_grouping", () => {
    const result = filterIssues(SAMPLE_ISSUES, { type: "variant_grouping" });
    expect(result).toHaveLength(2); // NO_VARIANTS + EMPTY_OPTION
  });

  it("combines severity + type filters", () => {
    const result = filterIssues(SAMPLE_ISSUES, { severity: "blocking", type: "missing_value" });
    expect(result).toHaveLength(1); // only MISSING_TITLE is blocking + missing_value
    expect(result[0].code).toBe("MISSING_TITLE");
  });

  it("returns empty for non-matching filters", () => {
    expect(filterIssues(SAMPLE_ISSUES, { severity: "info" })).toHaveLength(0);
    expect(filterIssues(SAMPLE_ISSUES, { type: "image", severity: "blocking" })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getAffectedKeys
// ---------------------------------------------------------------------------

describe("getAffectedKeys", () => {
  it("returns all unique source keys with no filters", () => {
    const keys = getAffectedKeys(SAMPLE_ISSUES, {});
    // P1-P8 but DUPLICATE issues have no sourceKey
    expect(keys.size).toBeGreaterThanOrEqual(7);
  });

  it("returns only keys from blocking issues", () => {
    const keys = getAffectedKeys(SAMPLE_ISSUES, { severity: "blocking" });
    expect(keys.has("P1")).toBe(true); // MISSING_TITLE
    expect(keys.has("P2")).toBe(true); // NO_VARIANTS
    expect(keys.has("P8")).toBe(true); // MALFORMED_PRICE
    expect(keys.has("P3")).toBe(false); // warning, not blocking
  });

  it("returns keys for missing_value type", () => {
    const keys = getAffectedKeys(SAMPLE_ISSUES, { type: "missing_value" });
    expect(keys.has("P1")).toBe(true);
    expect(keys.has("P3")).toBe(true);
    expect(keys.has("P4")).toBe(true);
    expect(keys.has("P5")).toBe(false); // SUSPICIOUS_HIGH_PRICE, not missing
  });

  it("excludes issues without sourceKey", () => {
    const keys = getAffectedKeys(SAMPLE_ISSUES, { type: "duplicate" });
    // DUPLICATE issues in our fixtures have no sourceKey
    expect(keys.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// countIssues
// ---------------------------------------------------------------------------

describe("countIssues", () => {
  it("counts by type", () => {
    const { typeCounts } = countIssues(SAMPLE_ISSUES);
    expect(typeCounts["missing_value"]).toBe(3);
    expect(typeCounts["duplicate"]).toBe(2);
    expect(typeCounts["invalid_value"]).toBe(2);
    expect(typeCounts["image"]).toBe(1);
    expect(typeCounts["variant_grouping"]).toBe(2);
  });

  it("counts by severity", () => {
    const { severityCounts } = countIssues(SAMPLE_ISSUES);
    expect(severityCounts["blocking"]).toBe(3);
    expect(severityCounts["warning"]).toBe(7);
  });

  it("returns empty counts for empty list", () => {
    const { typeCounts, severityCounts } = countIssues([]);
    expect(Object.keys(typeCounts)).toHaveLength(0);
    expect(Object.keys(severityCounts)).toHaveLength(0);
  });
});
