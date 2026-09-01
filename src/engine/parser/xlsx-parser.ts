/**
 * XLSX Parser — Section 7
 *
 * Responsibilities:
 * - Parse workbook, list sheets
 * - Extract one selected data sheet
 * - Return displayed cell values (not formulas)
 * - Handle multi-sheet selection requirement
 */

import ExcelJS from "exceljs";
import { ParseError } from "@shared/errors.js";
import { MAX_UPLOAD_SIZE_BYTES } from "@shared/constants.js";
import type { ParsedSheet } from "./csv-parser.js";

export type XlsxSheetInfo = {
  name: string;
  rowCount: number;
  hasHeaders: boolean;
};

export type XlsxParseOptions = {
  /** Sheet name to parse; required if workbook has multiple candidate sheets */
  sheet?: string;
  maxSizeBytes?: number;
};

/**
 * List candidate data sheets in a workbook.
 */
export async function listSheets(buffer: Buffer): Promise<XlsxSheetInfo[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);

  const sheets: XlsxSheetInfo[] = [];

  for (const worksheet of workbook.worksheets) {
    const rowCount = worksheet.rowCount;
    // A sheet "has headers" if the first row has at least 2 non-empty cells
    const firstRow = worksheet.getRow(1);
    let nonEmptyCells = 0;
    firstRow.eachCell(() => {
      nonEmptyCells++;
    });

    sheets.push({
      name: worksheet.name,
      rowCount,
      hasHeaders: nonEmptyCells >= 2,
    });
  }

  return sheets;
}

/**
 * Parse a single sheet into the common ParsedSheet format.
 */
export async function parseXlsx(
  buffer: Buffer,
  options?: XlsxParseOptions,
): Promise<ParsedSheet> {
  const maxSize = options?.maxSizeBytes ?? MAX_UPLOAD_SIZE_BYTES;

  if (buffer.length === 0) {
    throw new ParseError("File is empty", "EMPTY_FILE");
  }

  if (buffer.length > maxSize) {
    throw new ParseError(
      `File size ${buffer.length} exceeds maximum ${maxSize} bytes`,
      "FILE_TOO_LARGE",
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never);
  } catch {
    throw new ParseError("Failed to parse XLSX file — it may be corrupted", "PARSE_FAILED");
  }

  if (workbook.worksheets.length === 0) {
    throw new ParseError("Workbook contains no sheets", "NO_SHEETS");
  }

  // Determine which sheet to parse
  let worksheet: ExcelJS.Worksheet;

  if (options?.sheet) {
    const found = workbook.worksheets.find((ws) => ws.name === options.sheet);
    if (!found) {
      const available = workbook.worksheets.map((ws) => ws.name).join(", ");
      throw new ParseError(
        `Sheet "${options.sheet}" not found. Available sheets: ${available}`,
        "SHEET_NOT_FOUND",
      );
    }
    worksheet = found;
  } else {
    // Find candidate sheets (has headers = at least 2 non-empty cells in row 1)
    const candidates = workbook.worksheets.filter((ws) => {
      const firstRow = ws.getRow(1);
      let nonEmpty = 0;
      firstRow.eachCell(() => {
        nonEmpty++;
      });
      return nonEmpty >= 2 && ws.rowCount > 1;
    });

    if (candidates.length === 0) {
      throw new ParseError(
        "No sheets with tabular data found",
        "NO_DATA_SHEETS",
      );
    }

    if (candidates.length > 1) {
      const names = candidates.map((ws) => ws.name).join(", ");
      throw new ParseError(
        `Multiple sheets contain tabular data: ${names}. Please specify which sheet to use.`,
        "MULTIPLE_SHEETS",
      );
    }

    worksheet = candidates[0];
  }

  // Extract headers from row 1
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  const colCount = worksheet.columnCount;

  for (let col = 1; col <= colCount; col++) {
    const cell = headerRow.getCell(col);
    headers.push(getCellDisplayValue(cell).trim().replace(/\s+/g, " "));
  }

  if (headers.every((h) => h === "")) {
    throw new ParseError("No recognizable headers found", "NO_HEADERS");
  }

  // Extract data rows
  const rows: Record<string, string>[] = [];

  for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);

    // Skip completely blank rows
    let hasData = false;
    row.eachCell(() => {
      hasData = true;
    });
    if (!hasData) continue;

    const obj: Record<string, string> = {};
    for (let col = 1; col <= colCount; col++) {
      const header = headers[col - 1] || `_column_${col - 1}`;
      const cell = row.getCell(col);
      obj[header] = getCellDisplayValue(cell).trim().replace(/\s+/g, " ");
    }
    rows.push(obj);
  }

  if (rows.length === 0) {
    throw new ParseError("Sheet has headers but no data rows", "NO_DATA_ROWS");
  }

  return {
    headers: headers.map((h, i) => h || `_column_${i}`),
    rows,
    delimiter: "xlsx",
    rowCount: rows.length,
  };
}

/**
 * Get the displayed value of a cell (resolving formulas to their result).
 */
function getCellDisplayValue(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";

  // Formula cells have a result property
  if (typeof value === "object" && "result" in value) {
    const result = (value as { result: unknown }).result;
    if (result === null || result === undefined) return "";
    return String(result);
  }

  // Rich text
  if (typeof value === "object" && "richText" in value) {
    const richText = (value as { richText: Array<{ text: string }> }).richText;
    return richText.map((part) => part.text).join("");
  }

  // Date
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}
