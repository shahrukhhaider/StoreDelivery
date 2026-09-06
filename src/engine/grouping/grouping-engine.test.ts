import { describe, it, expect } from "vitest";
import { groupRows } from "./grouping-engine.js";
import { validateCatalog } from "../validation/validation-engine.js";
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

  // --- Shopify CSV variant recognition ---

  describe("Shopify CSV variant format", () => {
    it("groups variant rows by Handle and inherits title from first row", () => {
      const sheet: ParsedSheet = {
        headers: ["Handle", "Title", "Vendor", "Option1 Value", "Variant SKU", "Variant Price", "Image Src"],
        rows: [
          { Handle: "cool-shirt", Title: "Cool Shirt", Vendor: "BrandX", "Option1 Value": "Red", "Variant SKU": "CS-RED", "Variant Price": "29.99", "Image Src": "https://img.com/shirt.jpg" },
          { Handle: "cool-shirt", Title: "", Vendor: "", "Option1 Value": "Blue", "Variant SKU": "CS-BLU", "Variant Price": "29.99", "Image Src": "" },
          { Handle: "cool-shirt", Title: "", Vendor: "", "Option1 Value": "Green", "Variant SKU": "CS-GRN", "Variant Price": "29.99", "Image Src": "https://img.com/shirt-green.jpg" },
          { Handle: "nice-pants", Title: "Nice Pants", Vendor: "BrandY", "Option1 Value": "S", "Variant SKU": "NP-S", "Variant Price": "49.99", "Image Src": "https://img.com/pants.jpg" },
          { Handle: "nice-pants", Title: "", Vendor: "", "Option1 Value": "M", "Variant SKU": "NP-M", "Variant Price": "49.99", "Image Src": "" },
        ],
        delimiter: ",",
        rowCount: 5,
      };

      const mappings = [
        mapping("Handle", "grouping.parentKey"),
        mapping("Title", "product.title"),
        mapping("Vendor", "product.vendor"),
        mapping("Option1 Value", "variant.option1"),
        mapping("Variant SKU", "variant.sku"),
        mapping("Variant Price", "variant.price"),
        mapping("Image Src", "image.url"),
      ];

      const result = groupRows(sheet, mappings);

      // Should produce 2 products, not 5
      expect(result.products).toHaveLength(2);

      const shirt = result.products.find((p) => p.title === "Cool Shirt");
      expect(shirt).toBeTruthy();
      expect(shirt!.variants).toHaveLength(3);
      expect(shirt!.vendor).toBe("BrandX");
      expect(shirt!.variants[0].sku).toBe("CS-RED");
      expect(shirt!.variants[1].sku).toBe("CS-BLU");
      expect(shirt!.variants[2].sku).toBe("CS-GRN");

      const pants = result.products.find((p) => p.title === "Nice Pants");
      expect(pants).toBeTruthy();
      expect(pants!.variants).toHaveLength(2);
      expect(pants!.vendor).toBe("BrandY");
    });

    it("inherits title from first non-empty row even if first row is blank", () => {
      const sheet: ParsedSheet = {
        headers: ["Handle", "Title", "Option1 Value", "Variant Price"],
        rows: [
          // Unusual ordering: blank title first, real title second
          { Handle: "widget", Title: "", "Option1 Value": "Small", "Variant Price": "10" },
          { Handle: "widget", Title: "Widget Pro", "Option1 Value": "Large", "Variant Price": "15" },
        ],
        delimiter: ",",
        rowCount: 2,
      };

      const mappings = [
        mapping("Handle", "grouping.parentKey"),
        mapping("Title", "product.title"),
        mapping("Option1 Value", "variant.option1"),
        mapping("Variant Price", "variant.price"),
      ];

      const result = groupRows(sheet, mappings);
      expect(result.products).toHaveLength(1);
      expect(result.products[0].title).toBe("Widget Pro");
      expect(result.products[0].variants).toHaveLength(2);
    });

    it("inherits vendor and description from parent row", () => {
      const sheet: ParsedSheet = {
        headers: ["Handle", "Title", "Body (HTML)", "Vendor", "Variant SKU"],
        rows: [
          { Handle: "gadget", Title: "Gadget", "Body (HTML)": "A cool gadget", Vendor: "GadgetCo", "Variant SKU": "G-1" },
          { Handle: "gadget", Title: "", "Body (HTML)": "", Vendor: "", "Variant SKU": "G-2" },
          { Handle: "gadget", Title: "", "Body (HTML)": "", Vendor: "", "Variant SKU": "G-3" },
        ],
        delimiter: ",",
        rowCount: 3,
      };

      const mappings = [
        mapping("Handle", "grouping.parentKey"),
        mapping("Title", "product.title"),
        mapping("Body (HTML)", "product.description"),
        mapping("Vendor", "product.vendor"),
        mapping("Variant SKU", "variant.sku"),
      ];

      const result = groupRows(sheet, mappings);
      expect(result.products).toHaveLength(1);
      expect(result.products[0].title).toBe("Gadget");
      expect(result.products[0].vendor).toBe("GadgetCo");
      expect(result.products[0].description).toBe("A cool gadget");
      expect(result.products[0].variants).toHaveLength(3);
    });

    it("does not produce blocking issues for variant rows with empty titles", () => {
      // This is the key test — variant rows should NOT be treated as
      // separate products with missing titles
      const sheet: ParsedSheet = {
        headers: ["Handle", "Title", "Option1 Value", "Variant SKU", "Variant Price"],
        rows: [
          { Handle: "wheels", Title: "Pro Wheels", "Option1 Value": "Red", "Variant SKU": "W-RED", "Variant Price": "160" },
          { Handle: "wheels", Title: "", "Option1 Value": "Silver", "Variant SKU": "W-SIL", "Variant Price": "160" },
          { Handle: "wheels", Title: "", "Option1 Value": "White", "Variant SKU": "W-WHT", "Variant Price": "160" },
          { Handle: "wheels", Title: "", "Option1 Value": "Black", "Variant SKU": "W-BLK", "Variant Price": "160" },
        ],
        delimiter: ",",
        rowCount: 4,
      };

      const mappings = [
        mapping("Handle", "grouping.parentKey"),
        mapping("Title", "product.title"),
        mapping("Option1 Value", "variant.option1"),
        mapping("Variant SKU", "variant.sku"),
        mapping("Variant Price", "variant.price"),
      ];

      const result = groupRows(sheet, mappings);

      // Should be 1 product with 4 variants, NOT 4 products
      expect(result.products).toHaveLength(1);
      expect(result.products[0].title).toBe("Pro Wheels");
      expect(result.products[0].variants).toHaveLength(4);
      expect(result.products[0].variants.map((v) => v.sku)).toEqual([
        "W-RED", "W-SIL", "W-WHT", "W-BLK",
      ]);

      // Validate: zero blocking issues
      const validationResult = validateCatalog(result.products);
      expect(validationResult.blockingCount).toBe(0);
    });

    it("collects images from all variant rows and deduplicates", () => {
      const sheet: ParsedSheet = {
        headers: ["Handle", "Title", "Image Src"],
        rows: [
          { Handle: "bag", Title: "Bag", "Image Src": "https://img.com/bag-front.jpg" },
          { Handle: "bag", Title: "", "Image Src": "https://img.com/bag-side.jpg" },
          { Handle: "bag", Title: "", "Image Src": "https://img.com/bag-front.jpg" }, // duplicate
        ],
        delimiter: ",",
        rowCount: 3,
      };

      const mappings = [
        mapping("Handle", "grouping.parentKey"),
        mapping("Title", "product.title"),
        mapping("Image Src", "image.url"),
      ];

      const result = groupRows(sheet, mappings);
      expect(result.products).toHaveLength(1);
      // 2 unique images, not 3
      expect(result.products[0].images).toHaveLength(2);
    });

    it("handles single-row products alongside multi-row variant groups", () => {
      const sheet: ParsedSheet = {
        headers: ["Handle", "Title", "Option1 Value", "Variant SKU"],
        rows: [
          { Handle: "tee", Title: "Basic Tee", "Option1 Value": "S", "Variant SKU": "TEE-S" },
          { Handle: "tee", Title: "", "Option1 Value": "M", "Variant SKU": "TEE-M" },
          { Handle: "tee", Title: "", "Option1 Value": "L", "Variant SKU": "TEE-L" },
          { Handle: "mug", Title: "Coffee Mug", "Option1 Value": "", "Variant SKU": "MUG-1" },
        ],
        delimiter: ",",
        rowCount: 4,
      };

      const mappings = [
        mapping("Handle", "grouping.parentKey"),
        mapping("Title", "product.title"),
        mapping("Option1 Value", "variant.option1"),
        mapping("Variant SKU", "variant.sku"),
      ];

      const result = groupRows(sheet, mappings);
      expect(result.products).toHaveLength(2);

      const tee = result.products.find((p) => p.title === "Basic Tee");
      expect(tee!.variants).toHaveLength(3);

      const mug = result.products.find((p) => p.title === "Coffee Mug");
      expect(mug!.variants).toHaveLength(1);
    });
  });
});
