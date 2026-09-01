import { describe, it, expect } from "vitest";
import { parseCsv, detectDelimiter } from "./csv-parser.js";
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURES = join(__dirname, "../../../test/fixtures");

function fixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

describe("detectDelimiter", () => {
  it("detects comma", () => {
    expect(detectDelimiter("a,b,c\n1,2,3\n4,5,6")).toBe(",");
  });

  it("detects tab", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });

  it("detects semicolon", () => {
    expect(detectDelimiter("a;b;c\n1;2;3\n4;5;6")).toBe(";");
  });

  it("defaults to comma for ambiguous input", () => {
    expect(detectDelimiter("hello world")).toBe(",");
  });
});

describe("parseCsv", () => {
  it("parses simple.csv correctly", async () => {
    const result = await parseCsv(fixture("simple.csv"));
    expect(result.delimiter).toBe(",");
    expect(result.rowCount).toBe(5);
    expect(result.headers).toContain("SKU");
    expect(result.headers).toContain("Product Name");
    expect(result.headers).toContain("Price");
    expect(result.rows[0]["SKU"]).toBe("WIDGET-001");
    expect(result.rows[0]["Price"]).toBe("24.99");
  });

  it("parses tab-delimited files", async () => {
    const result = await parseCsv(fixture("tab-delimited.csv"));
    expect(result.delimiter).toBe("\t");
    expect(result.rowCount).toBe(6);
    expect(result.rows[0]["Stock Code"]).toBe("TAB-001");
  });

  it("parses semicolon-delimited european files", async () => {
    const result = await parseCsv(fixture("european-prices.csv"));
    expect(result.delimiter).toBe(";");
    expect(result.rowCount).toBe(5);
    expect(result.rows[0]["Artikelnummer"]).toBe("DE-001");
  });

  it("handles UTF-8 BOM", async () => {
    const result = await parseCsv(fixture("bom-utf8.csv"));
    expect(result.headers[0]).toBe("SKU");
    expect(result.rowCount).toBe(2);
  });

  it("handles special characters and encoding", async () => {
    const result = await parseCsv(fixture("weird-encoding.csv"));
    expect(result.rowCount).toBe(5);
    expect(result.rows[0]["Product Name"]).toContain("Café");
    expect(result.rows[4]["Product Name"]).toContain("日本茶");
  });

  it("parses quoted fields with embedded commas/quotes", async () => {
    const result = await parseCsv(fixture("weird-encoding.csv"));
    // Row 2 has embedded quotes in description: 24×36"
    expect(result.rows[1]["Product Name"]).toContain("24×36");
  });

  it("handles duplicate-skus file correctly", async () => {
    const result = await parseCsv(fixture("duplicate-skus.csv"));
    expect(result.rowCount).toBe(6);
  });

  it("parses large catalog within reasonable time", async () => {
    const start = Date.now();
    const result = await parseCsv(fixture("large-catalog.csv"));
    const elapsed = Date.now() - start;
    expect(result.rowCount).toBe(500);
    expect(elapsed).toBeLessThan(5000); // Should finish in <5s
  });

  it("rejects empty files", async () => {
    await expect(parseCsv(Buffer.from(""))).rejects.toThrow("empty");
  });

  it("rejects files with only whitespace", async () => {
    await expect(parseCsv(Buffer.from("   \n  \n  "))).rejects.toThrow(
      "no data",
    );
  });

  it("rejects binary data", async () => {
    const binary = Buffer.alloc(100);
    binary[10] = 0x00;
    binary[0] = 0x50; // 'P'
    await expect(parseCsv(binary)).rejects.toThrow("binary");
  });

  it("rejects oversized files", async () => {
    const tiny = Buffer.from("a,b\n1,2");
    await expect(parseCsv(tiny, { maxSizeBytes: 5 })).rejects.toThrow(
      "exceeds",
    );
  });

  it("rejects files with header but no data rows", async () => {
    await expect(parseCsv(Buffer.from("SKU,Name,Price\n"))).rejects.toThrow(
      "no data",
    );
  });

  it("skips completely blank rows", async () => {
    const csv = "SKU,Name\nA,Widget\n,,\nB,Gadget\n";
    const result = await parseCsv(Buffer.from(csv));
    expect(result.rowCount).toBe(2);
  });

  it("normalizes whitespace in headers and cells", async () => {
    const csv = "  SKU  ,  Product   Name  \n  A  ,  Blue   Widget  \n";
    const result = await parseCsv(Buffer.from(csv));
    expect(result.headers).toEqual(["SKU", "Product Name"]);
    expect(result.rows[0]["SKU"]).toBe("A");
    expect(result.rows[0]["Product Name"]).toBe("Blue Widget");
  });

  it("allows overriding delimiter", async () => {
    const csv = "a|b|c\n1|2|3";
    const result = await parseCsv(Buffer.from(csv), { delimiter: "|" });
    expect(result.headers).toEqual(["a", "b", "c"]);
  });
});
