import { describe, it, expect } from "vitest";
import { processCatalog } from "./pipeline.js";
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES = join(__dirname, "../../test/fixtures");

function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

describe("processCatalog — end-to-end", () => {
  it("processes simple.csv into a valid catalog", async () => {
    const result = await processCatalog(fixture("simple.csv"), {
      format: "csv",
      shopId: "shop_test",
      uploadId: "upload_001",
      fileName: "simple.csv",
    });

    const { catalog, sheet, mappingResult } = result;

    // Sheet parsed correctly
    expect(sheet.rowCount).toBe(5);
    expect(sheet.headers).toContain("SKU");

    // Mappings resolved
    expect(mappingResult.mappings.length).toBeGreaterThan(0);
    const skuMapping = mappingResult.mappings.find(
      (m) => m.sourceColumn === "SKU",
    );
    expect(skuMapping?.targetField).toBe("variant.sku");

    // Products created
    expect(catalog.products.length).toBe(5);
    expect(catalog.products[0].title).toBeTruthy();
    expect(catalog.products[0].variants.length).toBe(1);
    expect(catalog.products[0].variants[0].price).toBeTruthy();

    // Images linked
    expect(catalog.products[0].images.length).toBe(1);

    // Source metadata
    expect(catalog.source.fileName).toBe("simple.csv");
    expect(catalog.source.format).toBe("csv");
    expect(catalog.source.schemaFingerprint).toBeTruthy();

    // No blocking issues
    const blocking = catalog.issues.filter((i) => i.severity === "blocking");
    expect(blocking).toHaveLength(0);
  });

  it("processes variants-rows.csv with parent key grouping", async () => {
    const result = await processCatalog(fixture("variants-rows.csv"), {
      format: "csv",
      shopId: "shop_test",
      uploadId: "upload_002",
      fileName: "variants-rows.csv",
    });

    const { catalog } = result;

    // Should group into 2 products (TSHIRT-001 and HOODIE-001)
    expect(catalog.products.length).toBe(2);

    const tshirt = catalog.products.find((p) => p.title === "Classic Tee");
    expect(tshirt).toBeTruthy();
    expect(tshirt!.variants.length).toBe(6);

    const hoodie = catalog.products.find((p) => p.title === "Zip Hoodie");
    expect(hoodie).toBeTruthy();
    expect(hoodie!.variants.length).toBe(4);
  });

  it("processes european-prices.csv with semicolons and EU formatting", async () => {
    const result = await processCatalog(fixture("european-prices.csv"), {
      format: "csv",
      shopId: "shop_test",
      uploadId: "upload_003",
      fileName: "european-prices.csv",
    });

    const { catalog, sheet } = result;

    expect(sheet.delimiter).toBe(";");
    expect(catalog.products.length).toBe(5);
  });

  it("processes tab-delimited.csv", async () => {
    const result = await processCatalog(fixture("tab-delimited.csv"), {
      format: "csv",
      shopId: "shop_test",
      uploadId: "upload_004",
      fileName: "tab-delimited.csv",
    });

    const { catalog, sheet } = result;

    expect(sheet.delimiter).toBe("\t");
    expect(catalog.products.length).toBe(6);
    expect(catalog.products[0].variants[0].barcode).toBeTruthy();
  });

  it("detects duplicate SKUs in duplicate-skus.csv", async () => {
    const result = await processCatalog(fixture("duplicate-skus.csv"), {
      format: "csv",
      shopId: "shop_test",
      uploadId: "upload_005",
      fileName: "duplicate-skus.csv",
    });

    const { catalog } = result;

    const dupIssues = catalog.issues.filter(
      (i) => i.code === "DUPLICATE_SKU" || i.code === "DUPLICATE_BARCODE",
    );
    expect(dupIssues.length).toBeGreaterThan(0);
  });

  it("handles weird-encoding.csv with unicode chars", async () => {
    const result = await processCatalog(fixture("weird-encoding.csv"), {
      format: "csv",
      shopId: "shop_test",
      uploadId: "upload_006",
      fileName: "weird-encoding.csv",
    });

    const { catalog } = result;

    expect(catalog.products.length).toBe(5);
    // Check unicode survived
    const cafe = catalog.products.find((p) =>
      p.title.includes("Café"),
    );
    expect(cafe).toBeTruthy();
  });

  it("processes large-catalog.csv (500 rows) quickly", async () => {
    const start = Date.now();
    const result = await processCatalog(fixture("large-catalog.csv"), {
      format: "csv",
      shopId: "shop_test",
      uploadId: "upload_007",
      fileName: "large-catalog.csv",
    });
    const elapsed = Date.now() - start;

    expect(result.catalog.products.length).toBe(500);
    expect(elapsed).toBeLessThan(10000); // Should be well under 10s
  });

  it("processes bad-headers.csv (French headers, mostly unmapped)", async () => {
    const result = await processCatalog(fixture("bad-headers.csv"), {
      format: "csv",
      shopId: "shop_test",
      uploadId: "upload_008",
      fileName: "bad-headers.csv",
    });

    // Should still parse and produce products
    expect(result.catalog.products.length).toBe(5);
    // Some columns may be mapped via multilingual aliases, some won't
    expect(result.mappingResult.mappings.length).toBeGreaterThan(0);
  });

  it("generates stable fingerprints for same schema", async () => {
    const r1 = await processCatalog(fixture("simple.csv"), {
      format: "csv",
      shopId: "shop_test",
      uploadId: "u1",
      fileName: "simple.csv",
    });
    const r2 = await processCatalog(fixture("simple.csv"), {
      format: "csv",
      shopId: "shop_test",
      uploadId: "u2",
      fileName: "simple.csv",
    });

    expect(r1.catalog.source.schemaFingerprint).toBe(
      r2.catalog.source.schemaFingerprint,
    );
  });

  it("accepts pre-existing mappings", async () => {
    const result = await processCatalog(fixture("simple.csv"), {
      format: "csv",
      shopId: "shop_test",
      uploadId: "upload_009",
      fileName: "simple.csv",
      existingMappings: [
        {
          sourceColumn: "SKU",
          targetField: "variant.sku",
          confidence: "high",
          mappingSource: "user",
          ignored: false,
        },
        {
          sourceColumn: "Product Name",
          targetField: "product.title",
          confidence: "high",
          mappingSource: "user",
          ignored: false,
        },
        {
          sourceColumn: "Price",
          targetField: "variant.price",
          confidence: "high",
          mappingSource: "user",
          ignored: false,
        },
        {
          sourceColumn: "Description",
          targetField: "product.description",
          confidence: "high",
          mappingSource: "user",
          ignored: false,
        },
        {
          sourceColumn: "Brand",
          targetField: "product.vendor",
          confidence: "high",
          mappingSource: "user",
          ignored: false,
        },
        {
          sourceColumn: "Compare At Price",
          targetField: "variant.compareAtPrice",
          confidence: "high",
          mappingSource: "user",
          ignored: false,
        },
        {
          sourceColumn: "Quantity",
          targetField: "variant.inventoryQuantity",
          confidence: "high",
          mappingSource: "user",
          ignored: false,
        },
        {
          sourceColumn: "Image URL",
          targetField: "image.url",
          confidence: "high",
          mappingSource: "user",
          ignored: false,
        },
      ],
    });

    expect(result.catalog.products.length).toBe(5);
    // All mappings should be from "user"
    expect(
      result.mappingResult.mappings.every((m) => m.mappingSource === "user"),
    ).toBe(true);
  });
});
