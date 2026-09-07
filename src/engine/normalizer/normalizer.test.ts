import { describe, it, expect } from "vitest";
import {
  normalizePrice,
  normalizeInteger,
  normalizeWeight,
  normalizeTags,
  normalizeText,
  normalizeIdentifier,
} from "./normalizer.js";

describe("normalizePrice", () => {
  it("handles US format: $24.99", () => {
    expect(normalizePrice("$24.99")).toBe("24.99");
  });

  it("handles bare decimal: 24.99", () => {
    expect(normalizePrice("24.99")).toBe("24.99");
  });

  it("handles US thousands: $1,234.56", () => {
    expect(normalizePrice("$1,234.56")).toBe("1234.56");
  });

  it("handles European format: 1.234,56", () => {
    expect(normalizePrice("1.234,56")).toBe("1234.56");
  });

  it("handles short European: 12,99", () => {
    expect(normalizePrice("12,99")).toBe("12.99");
  });

  it("handles euro symbol: €24,99", () => {
    expect(normalizePrice("€24,99")).toBe("24.99");
  });

  it("handles pound symbol: £99.99", () => {
    expect(normalizePrice("£99.99")).toBe("99.99");
  });

  it("handles whole numbers: 50", () => {
    expect(normalizePrice("50")).toBe("50.00");
  });

  it("returns null for empty string", () => {
    expect(normalizePrice("")).toBeNull();
  });

  it("returns null for N/A", () => {
    expect(normalizePrice("N/A")).toBeNull();
  });

  it("returns null for TBD", () => {
    expect(normalizePrice("TBD")).toBeNull();
  });

  it("returns null for free", () => {
    expect(normalizePrice("free")).toBeNull();
  });

  it("returns null for non-numeric", () => {
    expect(normalizePrice("hello")).toBeNull();
  });

  it("handles leading/trailing whitespace", () => {
    expect(normalizePrice("  $24.99  ")).toBe("24.99");
  });
});

describe("normalizeInteger", () => {
  it("parses simple integer", () => {
    expect(normalizeInteger("42")).toBe(42);
  });

  it("parses with thousand separator", () => {
    expect(normalizeInteger("1,500")).toBe(1500);
  });

  it("returns null for empty", () => {
    expect(normalizeInteger("")).toBeNull();
  });

  it("returns null for N/A", () => {
    expect(normalizeInteger("N/A")).toBeNull();
  });

  it("returns null for non-numeric", () => {
    expect(normalizeInteger("hello")).toBeNull();
  });

  it("handles negative numbers", () => {
    expect(normalizeInteger("-5")).toBe(-5);
  });
});

describe("normalizeWeight", () => {
  it("parses weight with unit: 2.5 lbs", () => {
    const result = normalizeWeight("2.5 lbs");
    expect(result).toEqual({ value: 2.5, unit: "lb" });
  });

  it("parses weight without space: 10kg", () => {
    const result = normalizeWeight("10kg");
    expect(result).toEqual({ value: 10, unit: "kg" });
  });

  it("parses European decimal: 8,2 kg", () => {
    const result = normalizeWeight("8,2 kg");
    expect(result).toEqual({ value: 8.2, unit: "kg" });
  });

  it("parses bare number (defaults to lb)", () => {
    const result = normalizeWeight("5");
    expect(result).toEqual({ value: 5, unit: "lb" });
  });

  it("normalizes unit: ounces → oz", () => {
    const result = normalizeWeight("12 ounces");
    expect(result).toEqual({ value: 12, unit: "oz" });
  });

  it("returns null for empty", () => {
    expect(normalizeWeight("")).toBeNull();
  });

  it("returns null for non-numeric", () => {
    expect(normalizeWeight("heavy")).toBeNull();
  });
});

describe("normalizeTags", () => {
  it("splits on commas", () => {
    expect(normalizeTags("red, blue, green")).toEqual(["red", "blue", "green"]);
  });

  it("splits on semicolons", () => {
    expect(normalizeTags("a;b;c")).toEqual(["a", "b", "c"]);
  });

  it("splits on pipes", () => {
    expect(normalizeTags("x|y|z")).toEqual(["x", "y", "z"]);
  });

  it("deduplicates (case-insensitive)", () => {
    expect(normalizeTags("Red, red, RED")).toEqual(["Red"]);
  });

  it("trims whitespace", () => {
    expect(normalizeTags("  a , b , c  ")).toEqual(["a", "b", "c"]);
  });

  it("returns empty array for empty string", () => {
    expect(normalizeTags("")).toEqual([]);
  });

  it("filters out empty segments", () => {
    expect(normalizeTags("a,,b,")).toEqual(["a", "b"]);
  });
});

describe("normalizeText", () => {
  it("trims whitespace", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeText("hello   world")).toBe("hello world");
  });

  it("strips control characters", () => {
    expect(normalizeText("hello\x00world")).toBe("helloworld");
  });

  it("returns empty for null-like input", () => {
    expect(normalizeText("")).toBe("");
  });

  it("preserves unicode", () => {
    expect(normalizeText("  Café Müller  ")).toBe("Café Müller");
  });
});

// ---------------------------------------------------------------------------
// normalizeIdentifier — SKU, barcode, MPN cleanup
// ---------------------------------------------------------------------------

describe("normalizeIdentifier", () => {
  it("strips leading apostrophe (Excel text-force)", () => {
    expect(normalizeIdentifier("'4160")).toBe("4160");
  });

  it("strips leading equals sign (formula artifact)", () => {
    expect(normalizeIdentifier("=SKU123")).toBe("SKU123");
  });

  it("strips surrounding double quotes", () => {
    expect(normalizeIdentifier('"SKU-001"')).toBe("SKU-001");
  });

  it("trims whitespace", () => {
    expect(normalizeIdentifier("  ABC-123  ")).toBe("ABC-123");
  });

  it("strips zero-width characters and BOM", () => {
    expect(normalizeIdentifier("\uFEFFSKU-001")).toBe("SKU-001");
    expect(normalizeIdentifier("SKU\u200B001")).toBe("SKU001");
  });

  it("strips control characters", () => {
    expect(normalizeIdentifier("SKU\x00\x01001")).toBe("SKU001");
  });

  it("returns empty string for null/empty input", () => {
    expect(normalizeIdentifier("")).toBe("");
    expect(normalizeIdentifier("  ")).toBe("");
  });

  it("preserves valid identifiers unchanged", () => {
    expect(normalizeIdentifier("SKU-001")).toBe("SKU-001");
    expect(normalizeIdentifier("ABC123")).toBe("ABC123");
    expect(normalizeIdentifier("0123456789")).toBe("0123456789");
  });

  it("handles combined artifacts", () => {
    expect(normalizeIdentifier("  '\"SKU-001\"  ")).toBe("SKU-001");
  });
});

// ---------------------------------------------------------------------------
// Spreadsheet artifact cleanup (shared across normalizeText & normalizeIdentifier)
// ---------------------------------------------------------------------------

describe("normalizeText — spreadsheet artifact cleanup", () => {
  it("strips BOM from start of string", () => {
    expect(normalizeText("\uFEFFHello")).toBe("Hello");
  });

  it("strips zero-width characters", () => {
    expect(normalizeText("He\u200Bllo")).toBe("Hello");
  });

  it("replaces Unicode replacement character with empty", () => {
    expect(normalizeText("Hello\uFFFDWorld")).toBe("HelloWorld");
  });

  it("normalizes non-breaking spaces to regular spaces", () => {
    expect(normalizeText("Hello\u00A0World")).toBe("Hello World");
  });

  it("normalizes smart quotes to straight quotes", () => {
    expect(normalizeText("\u201CHello\u201D")).toBe('"Hello"');
    expect(normalizeText("\u2018Hello\u2019")).toBe("'Hello'");
  });

  it("normalizes em-dash and en-dash to hyphen", () => {
    expect(normalizeText("A\u2013B")).toBe("A-B");
    expect(normalizeText("A\u2014B")).toBe("A-B");
  });

  it("returns empty for spreadsheet error values", () => {
    expect(normalizeText("#N/A")).toBe("");
    expect(normalizeText("#REF!")).toBe("");
    expect(normalizeText("#VALUE!")).toBe("");
    expect(normalizeText("NULL")).toBe("");
    expect(normalizeText("null")).toBe("");
    expect(normalizeText("#NAME?")).toBe("");
    expect(normalizeText("#DIV/0!")).toBe("");
    expect(normalizeText("#NULL!")).toBe("");
  });

  it("preserves 'N/A' as a value (only #N/A is an error)", () => {
    expect(normalizeText("N/A")).toBe("N/A");
  });
});

describe("normalizeIdentifier — spreadsheet artifact cleanup", () => {
  it("strips BOM + leading apostrophe combined", () => {
    expect(normalizeIdentifier("\uFEFF'4160")).toBe("4160");
  });

  it("returns empty for null/NULL/nil", () => {
    expect(normalizeIdentifier("null")).toBe("");
    expect(normalizeIdentifier("NULL")).toBe("");
    expect(normalizeIdentifier("nil")).toBe("");
  });

  it("returns empty for #N/A and other error values", () => {
    expect(normalizeIdentifier("#N/A")).toBe("");
    expect(normalizeIdentifier("#REF!")).toBe("");
  });

  it("normalizes non-breaking space in identifier", () => {
    expect(normalizeIdentifier("SKU\u00A0001")).toBe("SKU 001");
  });

  it("strips replacement character from encoding errors", () => {
    expect(normalizeIdentifier("SKU\uFFFD001")).toBe("SKU001");
  });
});
