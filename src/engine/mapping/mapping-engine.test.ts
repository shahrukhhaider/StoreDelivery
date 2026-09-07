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

  // --- Shopify CSV option name mapping ---

  describe("Shopify CSV option name mapping", () => {
    it("maps Option1 Name to variant.option1Name with high confidence", async () => {
      const sheet: ParsedSheet = {
        headers: ["Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value"],
        rows: [
          { "Option1 Name": "Color", "Option1 Value": "Red", "Option2 Name": "Size", "Option2 Value": "S" },
          { "Option1 Name": "", "Option1 Value": "Blue", "Option2 Name": "", "Option2 Value": "M" },
        ],
        delimiter: ",",
        rowCount: 2,
      };

      const result = await mapColumns(sheet);

      const opt1Name = result.mappings.find((m) => m.sourceColumn === "Option1 Name");
      expect(opt1Name?.targetField).toBe("variant.option1Name");
      expect(opt1Name?.confidence).toBe("high");

      const opt1Value = result.mappings.find((m) => m.sourceColumn === "Option1 Value");
      expect(opt1Value?.targetField).toBe("variant.option1");
      expect(opt1Value?.confidence).toBe("high");

      const opt2Name = result.mappings.find((m) => m.sourceColumn === "Option2 Name");
      expect(opt2Name?.targetField).toBe("variant.option2Name");
      expect(opt2Name?.confidence).toBe("high");

      const opt2Value = result.mappings.find((m) => m.sourceColumn === "Option2 Value");
      expect(opt2Value?.targetField).toBe("variant.option2");
      expect(opt2Value?.confidence).toBe("high");
    });

    it("maps all Shopify CSV headers with zero unmapped", async () => {
      // Simulate the full Shopify bicycles CSV header set
      const headers = [
        "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published",
        "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value",
        "Option3 Name", "Option3 Value",
        "Variant SKU", "Variant Grams", "Variant Inventory Tracker",
        "Variant Inventory Qty", "Variant Inventory Policy",
        "Variant Fulfillment Service", "Variant Price", "Variant Compare At Price",
        "Variant Requires Shipping", "Variant Taxable", "Variant Barcode",
        "Image Src", "Image Alt Text", "Gift Card",
        "SEO Title", "SEO Description",
        "Google Shopping / Google Product Category",
        "Google Shopping / Gender", "Google Shopping / Age Group",
        "Google Shopping / MPN", "Google Shopping / AdWords Grouping",
        "Google Shopping / AdWords Labels", "Google Shopping / Condition",
        "Google Shopping / Custom Product",
        "Google Shopping / Custom Label 0", "Google Shopping / Custom Label 1",
        "Google Shopping / Custom Label 2", "Google Shopping / Custom Label 3",
        "Google Shopping / Custom Label 4",
        "Variant Image", "Variant Weight Unit",
      ];

      const rows = [Object.fromEntries(headers.map((h) => [h, "sample"]))];
      const sheet: ParsedSheet = { headers, rows, delimiter: ",", rowCount: 1 };

      const result = await mapColumns(sheet);

      // Every column should be mapped (not unmapped)
      expect(result.unmapped).toHaveLength(0);

      // Verify specific option name mappings
      expect(result.mappings.find((m) => m.sourceColumn === "Option1 Name")?.targetField).toBe("variant.option1Name");
      expect(result.mappings.find((m) => m.sourceColumn === "Option2 Name")?.targetField).toBe("variant.option2Name");
      expect(result.mappings.find((m) => m.sourceColumn === "Option3 Name")?.targetField).toBe("variant.option3Name");
      expect(result.mappings.find((m) => m.sourceColumn === "Variant Weight Unit")?.targetField).toBe("variant.weightUnit");
    });

    it("option name + value + grouping produce correct product options", async () => {
      // End-to-end: mapping → grouping verifies that the option names
      // are used as keys in the variant options
      const { groupRows } = await import("../grouping/grouping-engine.js");

      const sheet: ParsedSheet = {
        headers: ["Handle", "Title", "Option1 Name", "Option1 Value", "Variant SKU"],
        rows: [
          { Handle: "shoe", Title: "Running Shoe", "Option1 Name": "Size", "Option1 Value": "9", "Variant SKU": "SHOE-9" },
          { Handle: "shoe", Title: "", "Option1 Name": "", "Option1 Value": "10", "Variant SKU": "SHOE-10" },
          { Handle: "shoe", Title: "", "Option1 Name": "", "Option1 Value": "11", "Variant SKU": "SHOE-11" },
        ],
        delimiter: ",",
        rowCount: 3,
      };

      // Step 1: Map columns
      const mappingResult = await mapColumns(sheet);

      // Verify option name mapped
      expect(mappingResult.mappings.find((m) => m.sourceColumn === "Option1 Name")?.targetField).toBe("variant.option1Name");

      // Step 2: Group rows using the mappings
      const groupResult = groupRows(sheet, mappingResult.mappings);
      expect(groupResult.products).toHaveLength(1);

      const product = groupResult.products[0];
      expect(product.title).toBe("Running Shoe");
      expect(product.variants).toHaveLength(3);

      // Option key should be "Size", not "Option 1"
      expect(product.variants[0].options).toHaveProperty("Size", "9");
      expect(product.variants[1].options).toHaveProperty("Size", "10");
      expect(product.variants[2].options).toHaveProperty("Size", "11");
      expect(product.variants[0].options).not.toHaveProperty("Option 1");
    });
  });
});
