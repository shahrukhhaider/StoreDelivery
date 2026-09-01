import { describe, it, expect } from "vitest";
import { mapColumns } from "./mapping-engine.js";
import type { ParsedSheet } from "../parser/csv-parser.js";

function makeSheet(
  headers: string[],
  rows: Record<string, string>[] = [],
): ParsedSheet {
  // If no rows, generate sample rows with plausible data
  if (rows.length === 0) {
    rows = [
      Object.fromEntries(headers.map((h) => [h, `sample_${h}`])),
    ];
  }
  return { headers, rows, delimiter: ",", rowCount: rows.length };
}

describe("mapColumns", () => {
  it("maps simple well-known headers with high confidence", async () => {
    const sheet = makeSheet(["SKU", "Product Name", "Price", "Quantity"]);
    const result = await mapColumns(sheet);

    const skuMapping = result.mappings.find((m) => m.sourceColumn === "SKU");
    expect(skuMapping?.targetField).toBe("variant.sku");
    expect(skuMapping?.confidence).toBe("high");

    const nameMapping = result.mappings.find(
      (m) => m.sourceColumn === "Product Name",
    );
    expect(nameMapping?.targetField).toBe("product.title");
    expect(nameMapping?.confidence).toBe("high");

    expect(result.unmapped).toHaveLength(0);
  });

  it("marks unrecognized headers as unmapped", async () => {
    const sheet = makeSheet(["SKU", "Xylophone Rating", "Foobar Index"]);
    const result = await mapColumns(sheet);

    expect(result.unmapped).toContain("Xylophone Rating");
    expect(result.unmapped).toContain("Foobar Index");
  });

  it("uses type inference for unrecognized headers with typed values", async () => {
    const sheet: ParsedSheet = {
      headers: ["Code", "Link"],
      rows: [
        { Code: "ABC-001", Link: "https://img.example.com/a.jpg" },
        { Code: "ABC-002", Link: "https://img.example.com/b.jpg" },
        { Code: "ABC-003", Link: "https://img.example.com/c.jpg" },
      ],
      delimiter: ",",
      rowCount: 3,
    };

    const result = await mapColumns(sheet);
    const linkMapping = result.mappings.find((m) => m.sourceColumn === "Link");
    expect(linkMapping?.targetField).toBe("image.url");
    expect(linkMapping?.confidence).toBe("medium");
  });

  it("detects conflicts when two columns map to same target", async () => {
    // Both "Price" and "Retail Price" would map to variant.price
    const sheet = makeSheet(["SKU", "Price", "Retail Price", "Name"]);
    const result = await mapColumns(sheet);

    // Both should be marked for review
    expect(result.needsReview).toContain("Price");
    expect(result.needsReview).toContain("Retail Price");
  });

  it("handles completely unrecognizable headers", async () => {
    const sheet = makeSheet(["Col A", "Col B", "Col C"]);
    const result = await mapColumns(sheet);

    expect(result.unmapped).toHaveLength(3);
    expect(result.mappings.every((m) => m.targetField === null)).toBe(true);
  });

  it("allows multiple image columns without conflict", async () => {
    const sheet: ParsedSheet = {
      headers: ["SKU", "Image 1", "Image 2", "Image 3"],
      rows: [
        {
          SKU: "A",
          "Image 1": "https://a.com/1.jpg",
          "Image 2": "https://a.com/2.jpg",
          "Image 3": "https://a.com/3.jpg",
        },
      ],
      delimiter: ",",
      rowCount: 1,
    };

    const result = await mapColumns(sheet);
    const imageMappings = result.mappings.filter(
      (m) => m.targetField === "image.url",
    );
    expect(imageMappings).toHaveLength(3);
    // Image columns should NOT be flagged as conflicts
    expect(result.needsReview).not.toContain("Image 1");
  });

  it("returns all mappings for all headers", async () => {
    const headers = ["SKU", "Name", "Price", "Unknown1", "Unknown2"];
    const sheet = makeSheet(headers);
    const result = await mapColumns(sheet);
    expect(result.mappings).toHaveLength(5);
  });
});
