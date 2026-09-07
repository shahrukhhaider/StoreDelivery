/**
 * XLSX Parser tests — generates test workbooks in memory with ExcelJS.
 */

import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseXlsx, listSheets } from "./xlsx-parser.js";

async function makeXlsx(
  sheets: Array<{ name: string; rows: string[][] }>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    for (const row of sheet.rows) {
      ws.addRow(row);
    }
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// listSheets
// ---------------------------------------------------------------------------

describe("listSheets", () => {
  it("lists all sheets in a workbook", async () => {
    const buffer = await makeXlsx([
      { name: "Products", rows: [["SKU", "Name"], ["A", "Widget"]] },
      { name: "Prices", rows: [["SKU", "Price"], ["A", "10"]] },
    ]);
    const sheets = await listSheets(buffer);
    expect(sheets).toHaveLength(2);
    expect(sheets[0].name).toBe("Products");
    expect(sheets[1].name).toBe("Prices");
  });

  it("reports row count per sheet", async () => {
    const buffer = await makeXlsx([
      { name: "Data", rows: [["H1", "H2"], ["a", "b"], ["c", "d"], ["e", "f"]] },
    ]);
    const sheets = await listSheets(buffer);
    expect(sheets[0].rowCount).toBe(4); // header + 3 data rows
  });

  it("detects headers (first row with 2+ non-empty cells)", async () => {
    const buffer = await makeXlsx([
      { name: "HasHeaders", rows: [["SKU", "Name"], ["A", "Widget"]] },
      { name: "Empty", rows: [[""], ["only one col"]] },
    ]);
    const sheets = await listSheets(buffer);
    expect(sheets[0].hasHeaders).toBe(true);
    expect(sheets[1].hasHeaders).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseXlsx — single sheet
// ---------------------------------------------------------------------------

describe("parseXlsx", () => {
  it("parses a simple single-sheet workbook", async () => {
    const buffer = await makeXlsx([
      {
        name: "Products",
        rows: [
          ["SKU", "Product Name", "Price"],
          ["W-001", "Blue Widget", "24.99"],
          ["W-002", "Red Widget", "19.99"],
        ],
      },
    ]);

    const result = await parseXlsx(buffer);
    expect(result.headers).toEqual(["SKU", "Product Name", "Price"]);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]["SKU"]).toBe("W-001");
    expect(result.rows[0]["Product Name"]).toBe("Blue Widget");
    expect(result.rows[1]["Price"]).toBe("19.99");
  });

  it("returns xlsx as delimiter", async () => {
    const buffer = await makeXlsx([
      { name: "Sheet1", rows: [["A", "B"], ["1", "2"]] },
    ]);
    const result = await parseXlsx(buffer);
    expect(result.delimiter).toBe("xlsx");
  });

  it("handles numeric cell values as strings", async () => {
    const buffer = await makeXlsx([
      { name: "Sheet1", rows: [["SKU", "Qty"], ["A", "100"]] },
    ]);
    const result = await parseXlsx(buffer);
    expect(typeof result.rows[0]["Qty"]).toBe("string");
  });

  it("skips blank rows", async () => {
    const buffer = await makeXlsx([
      {
        name: "Sheet1",
        rows: [
          ["SKU", "Name"],
          ["A", "Widget"],
          [],
          ["B", "Gadget"],
        ],
      },
    ]);
    const result = await parseXlsx(buffer);
    expect(result.rowCount).toBe(2);
  });

  it("normalizes whitespace in headers and cells", async () => {
    const buffer = await makeXlsx([
      { name: "Sheet1", rows: [["  SKU  ", "  Name  "], ["  A  ", "  Widget  "]] },
    ]);
    const result = await parseXlsx(buffer);
    expect(result.headers[0]).toBe("SKU");
    expect(result.rows[0]["SKU"]).toBe("A");
    expect(result.rows[0]["Name"]).toBe("Widget");
  });
});

// ---------------------------------------------------------------------------
// parseXlsx — multi-sheet handling
// ---------------------------------------------------------------------------

describe("parseXlsx multi-sheet", () => {
  it("auto-selects the only candidate sheet", async () => {
    const buffer = await makeXlsx([
      { name: "Products", rows: [["SKU", "Name"], ["A", "Widget"]] },
      { name: "Notes", rows: [["Just a note"]] }, // not tabular
    ]);
    const result = await parseXlsx(buffer);
    expect(result.headers).toContain("SKU");
  });

  it("requires sheet selection when multiple candidates exist", async () => {
    const buffer = await makeXlsx([
      { name: "Products", rows: [["SKU", "Name"], ["A", "Widget"]] },
      { name: "Prices", rows: [["SKU", "Price"], ["A", "10"]] },
    ]);
    await expect(parseXlsx(buffer)).rejects.toThrow("Multiple sheets");
  });

  it("parses specified sheet by name", async () => {
    const buffer = await makeXlsx([
      { name: "Products", rows: [["SKU", "Name"], ["A", "Widget"]] },
      { name: "Prices", rows: [["SKU", "Price"], ["A", "10"]] },
    ]);
    const result = await parseXlsx(buffer, { sheet: "Prices" });
    expect(result.headers).toContain("Price");
    expect(result.rows[0]["Price"]).toBe("10");
  });

  it("throws for non-existent sheet name", async () => {
    const buffer = await makeXlsx([
      { name: "Products", rows: [["SKU", "Name"], ["A", "Widget"]] },
    ]);
    await expect(parseXlsx(buffer, { sheet: "Missing" })).rejects.toThrow("not found");
  });
});

// ---------------------------------------------------------------------------
// parseXlsx — error cases
// ---------------------------------------------------------------------------

describe("parseXlsx errors", () => {
  it("rejects empty buffer", async () => {
    await expect(parseXlsx(Buffer.from(""))).rejects.toThrow("empty");
  });

  it("rejects oversized files", async () => {
    const buffer = await makeXlsx([
      { name: "Sheet1", rows: [["A", "B"], ["1", "2"]] },
    ]);
    await expect(parseXlsx(buffer, { maxSizeBytes: 10 })).rejects.toThrow("exceeds");
  });

  it("rejects workbook with no data sheets", async () => {
    const buffer = await makeXlsx([
      { name: "Empty", rows: [["Only one cell"]] },
    ]);
    await expect(parseXlsx(buffer)).rejects.toThrow("No sheets");
  });

  it("rejects sheet with headers but no data rows", async () => {
    const buffer = await makeXlsx([
      { name: "Headers Only", rows: [["SKU", "Name"]] },
    ]);
    await expect(parseXlsx(buffer)).rejects.toThrow("No sheets");
  });
});
