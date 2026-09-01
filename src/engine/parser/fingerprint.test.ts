import { describe, it, expect } from "vitest";
import { generateFingerprint } from "./fingerprint.js";

describe("generateFingerprint", () => {
  it("produces a 16-char hex string", () => {
    const fp = generateFingerprint(["SKU", "Name", "Price"], ",", "csv");
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
  });

  it("is stable for same inputs", () => {
    const a = generateFingerprint(["SKU", "Name"], ",", "csv");
    const b = generateFingerprint(["SKU", "Name"], ",", "csv");
    expect(a).toBe(b);
  });

  it("is order-independent (same headers different order → same fingerprint)", () => {
    const a = generateFingerprint(["SKU", "Name", "Price"], ",", "csv");
    const b = generateFingerprint(["Price", "SKU", "Name"], ",", "csv");
    expect(a).toBe(b);
  });

  it("differs for different headers", () => {
    const a = generateFingerprint(["SKU", "Name"], ",", "csv");
    const b = generateFingerprint(["SKU", "Title"], ",", "csv");
    expect(a).not.toBe(b);
  });

  it("differs for different delimiters", () => {
    const a = generateFingerprint(["SKU", "Name"], ",", "csv");
    const b = generateFingerprint(["SKU", "Name"], ";", "csv");
    expect(a).not.toBe(b);
  });

  it("differs for different formats", () => {
    const a = generateFingerprint(["SKU", "Name"], ",", "csv");
    const b = generateFingerprint(["SKU", "Name"], ",", "xlsx");
    expect(a).not.toBe(b);
  });

  it("is case-insensitive", () => {
    const a = generateFingerprint(["SKU", "Name"], ",", "csv");
    const b = generateFingerprint(["sku", "name"], ",", "csv");
    expect(a).toBe(b);
  });
});
