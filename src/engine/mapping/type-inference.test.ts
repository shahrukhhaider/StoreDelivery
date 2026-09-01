import { describe, it, expect } from "vitest";
import { inferColumnType, inferAllColumnTypes } from "./type-inference.js";

describe("inferColumnType", () => {
  it("detects currency from dollar values", () => {
    const result = inferColumnType({
      header: "Price",
      values: ["$24.99", "$19.99", "$49.99", "$12.50", "$99.00"],
    });
    expect(result.inferredType).toBe("currency");
    expect(result.matchRate).toBeGreaterThanOrEqual(0.6);
  });

  it("detects currency from bare decimals", () => {
    const result = inferColumnType({
      header: "Cost",
      values: ["24.99", "19.99", "49.99", "12.50", "99.00"],
    });
    expect(result.inferredType).toBe("currency");
  });

  it("detects integers", () => {
    const result = inferColumnType({
      header: "Qty",
      values: ["100", "50", "200", "75", "10"],
    });
    expect(result.inferredType).toBe("integer");
  });

  it("detects URLs", () => {
    const result = inferColumnType({
      header: "Image",
      values: [
        "https://img.example.com/a.jpg",
        "https://img.example.com/b.jpg",
        "http://cdn.example.com/c.png",
      ],
    });
    expect(result.inferredType).toBe("url");
  });

  it("detects barcodes (12-digit UPC)", () => {
    const result = inferColumnType({
      header: "UPC",
      values: ["012345678901", "012345678902", "012345678903"],
    });
    expect(result.inferredType).toBe("barcode");
  });

  it("detects barcodes (13-digit EAN)", () => {
    const result = inferColumnType({
      header: "EAN",
      values: ["1234567890123", "1234567890124", "1234567890125"],
    });
    expect(result.inferredType).toBe("barcode");
  });

  it("detects booleans", () => {
    const result = inferColumnType({
      header: "Active",
      values: ["Yes", "No", "Yes", "Yes", "No"],
    });
    expect(result.inferredType).toBe("boolean");
  });

  it("detects categories (repeating values)", () => {
    const result = inferColumnType({
      header: "Department",
      values: [
        "Electronics",
        "Clothing",
        "Electronics",
        "Home",
        "Clothing",
        "Electronics",
        "Clothing",
        "Home",
      ],
    });
    expect(result.inferredType).toBe("category");
  });

  it("returns text for unique strings", () => {
    const result = inferColumnType({
      header: "Description",
      values: [
        "A blue widget for home use",
        "Premium red gadget with features",
        "Small compact device for travel",
        "Large industrial component",
        "Handcrafted wooden decoration",
      ],
    });
    expect(result.inferredType).toBe("text");
  });

  it("returns unknown for empty columns", () => {
    const result = inferColumnType({
      header: "Empty",
      values: ["", "", "", ""],
    });
    expect(result.inferredType).toBe("unknown");
    expect(result.matchRate).toBe(0);
  });

  it("handles mixed types — picks dominant", () => {
    const result = inferColumnType({
      header: "Mixed",
      values: ["$10.00", "$20.00", "$30.00", "N/A", "$40.00"],
    });
    // 4/5 match currency = 0.8 > threshold
    expect(result.inferredType).toBe("currency");
  });
});

describe("inferAllColumnTypes", () => {
  it("infers types for all columns", () => {
    const results = inferAllColumnTypes([
      { header: "Price", values: ["$10.00", "$20.00"] },
      { header: "Name", values: ["Widget", "Gadget"] },
      { header: "URL", values: ["https://a.com", "https://b.com"] },
    ]);
    expect(results).toHaveLength(3);
    expect(results[0].inferredType).toBe("currency");
    expect(results[2].inferredType).toBe("url");
  });
});
