import { describe, it, expect } from "vitest";
import { groupRows } from "./grouping-engine.js";
import type { ParsedSheet } from "../parser/csv-parser.js";
import type { FieldMapping, MappingConfidence, MappingSource } from "@shared/types/mapping.js";

function mapping(
  col: string,
  target: string | null,
): FieldMapping {
  return {
    sourceColumn: col,
    targetField: target as FieldMapping["targetField"],
    confidence: "high" as MappingConfidence,
    mappingSource: "rule" as MappingSource,
    ignored: false,
  };
}

describe("groupRows", () => {
  it("groups by parent key when available", () => {
    const sheet: ParsedSheet = {
      headers: ["Parent SKU", "SKU", "Product Name", "Color", "Price"],
      rows: [
        { "Parent SKU": "P1", SKU: "P1-RED", "Product Name": "Shirt", Color: "Red", Price: "20" },
        { "Parent SKU": "P1", SKU: "P1-BLU", "Product Name": "Shirt", Color: "Blue", Price: "20" },
        { "Parent SKU": "P2", SKU: "P2-BLK", "Product Name": "Pants", Color: "Black", Price: "40" },
      ],
      delimiter: ",",
      rowCount: 3,
    };

    const mappings = [
      mapping("Parent SKU", "grouping.parentKey"),
      mapping("SKU", "variant.sku"),
      mapping("Product Name", "product.title"),
      mapping("Color", "variant.option1"),
      mapping("Price", "variant.price"),
    ];

    const result = groupRows(sheet, mappings);
    expect(result.products).toHaveLength(2);

    const shirt = result.products.find((p) => p.title === "Shirt");
    expect(shirt?.variants).toHaveLength(2);
    expect(shirt?.variants[0].sku).toBe("P1-RED");
    expect(shirt?.variants[1].sku).toBe("P1-BLU");

    const pants = result.products.find((p) => p.title === "Pants");
    expect(pants?.variants).toHaveLength(1);
  });

  it("groups by title + options when no parent key", () => {
    const sheet: ParsedSheet = {
      headers: ["SKU", "Product Name", "Size", "Price"],
      rows: [
        { SKU: "A-S", "Product Name": "Hat", Size: "S", Price: "15" },
        { SKU: "A-M", "Product Name": "Hat", Size: "M", Price: "15" },
        { SKU: "A-L", "Product Name": "Hat", Size: "L", Price: "15" },
        { SKU: "B-1", "Product Name": "Scarf", Size: "One Size", Price: "25" },
      ],
      delimiter: ",",
      rowCount: 4,
    };

    const mappings = [
      mapping("SKU", "variant.sku"),
      mapping("Product Name", "product.title"),
      mapping("Size", "variant.option2"),
      mapping("Price", "variant.price"),
    ];

    const result = groupRows(sheet, mappings);
    expect(result.products).toHaveLength(2);

    const hat = result.products.find((p) => p.title === "Hat");
    expect(hat?.variants).toHaveLength(3);
  });

  it("falls back to standalone when no grouping signal", () => {
    const sheet: ParsedSheet = {
      headers: ["Name", "Price"],
      rows: [
        { Name: "Apple", Price: "1.00" },
        { Name: "Banana", Price: "0.50" },
        { Name: "Cherry", Price: "2.00" },
      ],
      delimiter: ",",
      rowCount: 3,
    };

    const mappings = [
      mapping("Name", "product.title"),
      mapping("Price", "variant.price"),
    ];

    const result = groupRows(sheet, mappings);
    expect(result.products).toHaveLength(3);
    expect(result.products.every((p) => p.variants.length === 1)).toBe(true);
  });

  it("normalizes prices during grouping", () => {
    const sheet: ParsedSheet = {
      headers: ["SKU", "Name", "Price"],
      rows: [
        { SKU: "A", Name: "Widget", Price: "$24.99" },
      ],
      delimiter: ",",
      rowCount: 1,
    };

    const mappings = [
      mapping("SKU", "variant.sku"),
      mapping("Name", "product.title"),
      mapping("Price", "variant.price"),
    ];

    const result = groupRows(sheet, mappings);
    expect(result.products[0].variants[0].price).toBe("24.99");
  });

  it("collects images from multiple image columns", () => {
    const sheet: ParsedSheet = {
      headers: ["SKU", "Name", "Image 1", "Image 2"],
      rows: [
        {
          SKU: "A",
          Name: "Widget",
          "Image 1": "https://img.com/a1.jpg",
          "Image 2": "https://img.com/a2.jpg",
        },
      ],
      delimiter: ",",
      rowCount: 1,
    };

    const mappings = [
      mapping("SKU", "variant.sku"),
      mapping("Name", "product.title"),
      mapping("Image 1", "image.url"),
      mapping("Image 2", "image.url"),
    ];

    const result = groupRows(sheet, mappings);
    expect(result.products[0].images).toHaveLength(2);
    expect(result.products[0].images[0].position).toBe(1);
    expect(result.products[0].images[1].position).toBe(2);
  });

  it("deduplicates images within a product group", () => {
    const sheet: ParsedSheet = {
      headers: ["Parent SKU", "SKU", "Name", "Image URL"],
      rows: [
        { "Parent SKU": "P1", SKU: "P1-A", Name: "Tee", "Image URL": "https://img.com/tee.jpg" },
        { "Parent SKU": "P1", SKU: "P1-B", Name: "Tee", "Image URL": "https://img.com/tee.jpg" },
      ],
      delimiter: ",",
      rowCount: 2,
    };

    const mappings = [
      mapping("Parent SKU", "grouping.parentKey"),
      mapping("SKU", "variant.sku"),
      mapping("Name", "product.title"),
      mapping("Image URL", "image.url"),
    ];

    const result = groupRows(sheet, mappings);
    // Same URL should only appear once
    expect(result.products[0].images).toHaveLength(1);
  });

  it("preserves sourceData on each variant", () => {
    const sheet: ParsedSheet = {
      headers: ["SKU", "Name", "Price", "Extra"],
      rows: [
        { SKU: "A", Name: "Widget", Price: "10", Extra: "foo" },
      ],
      delimiter: ",",
      rowCount: 1,
    };

    const mappings = [
      mapping("SKU", "variant.sku"),
      mapping("Name", "product.title"),
      mapping("Price", "variant.price"),
      mapping("Extra", null),
    ];

    const result = groupRows(sheet, mappings);
    expect(result.products[0].variants[0].sourceData).toHaveProperty("Extra", "foo");
  });

  it("flags ambiguous groups when title matches but no options", () => {
    const sheet: ParsedSheet = {
      headers: ["Name", "Price"],
      rows: [
        { Name: "Widget", Price: "10" },
        { Name: "Widget", Price: "15" },
        { Name: "Gadget", Price: "20" },
      ],
      delimiter: ",",
      rowCount: 3,
    };

    const mappings = [
      mapping("Name", "product.title"),
      mapping("Price", "variant.price"),
    ];

    const result = groupRows(sheet, mappings);
    // Two "Widget" rows grouped but no option column → ambiguous
    expect(result.ambiguousGroups.length).toBeGreaterThanOrEqual(1);
    expect(result.ambiguousGroups[0].proposedTitle).toBe("Widget");
  });
});
