import { describe, it, expect } from "vitest";
import {
  detectVendor,
  extractCandidateName,
  normalizeVendorName,
  type KnownVendor,
} from "./vendor-detection.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function vendor(overrides: Partial<KnownVendor> = {}): KnownVendor {
  return {
    id: "v1",
    name: "Acme Distribution",
    normalizedName: "acme-distribution",
    schemaFingerprint: "fp-abc123",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeVendorName
// ---------------------------------------------------------------------------

describe("normalizeVendorName", () => {
  it("lowercases and hyphenates", () => {
    expect(normalizeVendorName("Acme Distribution")).toBe("acme-distribution");
  });

  it("removes special characters", () => {
    expect(normalizeVendorName("Acme Distribution Ltd.")).toBe("acme-distribution-ltd");
  });

  it("collapses multiple separators", () => {
    expect(normalizeVendorName("Acme  --  Corp")).toBe("acme-corp");
  });

  it("trims leading and trailing hyphens", () => {
    expect(normalizeVendorName("  -Acme- ")).toBe("acme");
  });

  it("handles empty string", () => {
    expect(normalizeVendorName("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// extractCandidateName
// ---------------------------------------------------------------------------

describe("extractCandidateName", () => {
  it("returns single vendor name when all products share it", () => {
    expect(extractCandidateName(["Acme", "Acme", "Acme"])).toBe("Acme");
  });

  it("returns majority vendor name when >50% match", () => {
    expect(extractCandidateName(["Acme", "Acme", "Other"])).toBe("Acme");
  });

  it("returns null when split 50/50", () => {
    expect(extractCandidateName(["Acme", "Other"])).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(extractCandidateName([])).toBeNull();
  });

  it("ignores empty strings", () => {
    expect(extractCandidateName(["", "Acme", "Acme"])).toBe("Acme");
  });

  it("returns single value when only one", () => {
    expect(extractCandidateName(["Acme"])).toBe("Acme");
  });
});

// ---------------------------------------------------------------------------
// detectVendor — schema fingerprint
// ---------------------------------------------------------------------------

describe("detectVendor — schema fingerprint", () => {
  it("returns HIGH confidence on exact fingerprint match", () => {
    const result = detectVendor("fp-abc123", ["Acme"], [vendor()]);
    expect(result.confidence).toBe("HIGH");
    expect(result.matchedVendorId).toBe("v1");
    expect(result.matchedVendorName).toBe("Acme Distribution");
    expect(result.matchSource).toBe("schema_fingerprint");
  });

  it("fingerprint takes priority over vendor column match", () => {
    const vendors = [
      vendor({ id: "v1", normalizedName: "acme-distribution", schemaFingerprint: "fp-abc123" }),
      vendor({ id: "v2", name: "Different Corp", normalizedName: "different-corp", schemaFingerprint: null }),
    ];
    // Vendor column says "Different Corp" but fingerprint matches v1
    const result = detectVendor("fp-abc123", ["Different Corp"], vendors);
    expect(result.matchedVendorId).toBe("v1");
    expect(result.matchSource).toBe("schema_fingerprint");
  });

  it("falls through to vendor column when fingerprint does not match", () => {
    const result = detectVendor("fp-unknown", ["Acme Distribution"], [vendor({ schemaFingerprint: "fp-other" })]);
    expect(result.matchSource).toBe("vendor_column_exact");
  });

  it("falls through to vendor column when schemaFingerprint is null", () => {
    const result = detectVendor(null, ["Acme Distribution"], [vendor()]);
    expect(result.matchSource).toBe("vendor_column_exact");
  });
});

// ---------------------------------------------------------------------------
// detectVendor — vendor column exact match
// ---------------------------------------------------------------------------

describe("detectVendor — vendor column exact match", () => {
  it("returns HIGH confidence on exact normalized match", () => {
    const result = detectVendor(null, ["Acme Distribution"], [vendor()]);
    expect(result.confidence).toBe("HIGH");
    expect(result.matchedVendorId).toBe("v1");
    expect(result.matchSource).toBe("vendor_column_exact");
  });

  it("matches case-insensitively", () => {
    const result = detectVendor(null, ["ACME DISTRIBUTION"], [vendor()]);
    expect(result.confidence).toBe("HIGH");
    expect(result.matchedVendorId).toBe("v1");
  });

  it("matches with different punctuation", () => {
    // "Acme Distribution Ltd." normalizes to "acme-distribution-ltd"
    // known vendor is "acme-distribution" → not exact, falls to partial
    const result = detectVendor(null, ["Acme Distribution Ltd."], [vendor()]);
    expect(result.confidence).toBe("MEDIUM");
    expect(result.matchSource).toBe("vendor_column_partial");
  });
});

// ---------------------------------------------------------------------------
// detectVendor — partial match
// ---------------------------------------------------------------------------

describe("detectVendor — partial match", () => {
  it("returns MEDIUM confidence on partial normalized match", () => {
    // "Acme" normalizes to "acme" — contained in known "acme-distribution"
    const result = detectVendor(null, ["Acme"], [vendor()]);
    expect(result.confidence).toBe("MEDIUM");
    expect(result.matchedVendorId).toBe("v1");
    expect(result.matchSource).toBe("vendor_column_partial");
  });
});

// ---------------------------------------------------------------------------
// detectVendor — no match
// ---------------------------------------------------------------------------

describe("detectVendor — no match", () => {
  it("returns NONE when no vendors exist", () => {
    const result = detectVendor(null, ["Acme"], []);
    expect(result.confidence).toBe("NONE");
    expect(result.matchedVendorId).toBeNull();
    expect(result.matchSource).toBe("none");
  });

  it("returns NONE when vendor name doesn't match any known vendor", () => {
    const result = detectVendor(null, ["Totally Unknown Corp"], [vendor()]);
    expect(result.confidence).toBe("NONE");
    expect(result.matchedVendorId).toBeNull();
    expect(result.matchSource).toBe("none");
  });

  it("preserves candidateVendorName even when no match", () => {
    const result = detectVendor(null, ["NewCo Inc"], []);
    expect(result.candidateVendorName).toBe("NewCo Inc");
  });

  it("returns NONE when products have no vendor values", () => {
    const result = detectVendor(null, [], [vendor()]);
    expect(result.confidence).toBe("NONE");
    expect(result.candidateVendorName).toBeNull();
  });
});
