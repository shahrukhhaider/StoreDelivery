/**
 * Unified parser entry point.
 */

export { parseCsv, detectDelimiter } from "./csv-parser.js";
export type { ParsedSheet, CsvParseOptions } from "./csv-parser.js";
export { parseXlsx, listSheets } from "./xlsx-parser.js";
export type { XlsxSheetInfo, XlsxParseOptions } from "./xlsx-parser.js";
export { generateFingerprint } from "./fingerprint.js";

import type { CatalogFormat } from "@shared/types/catalog.js";
import type { ParsedSheet } from "./csv-parser.js";
import { parseCsv } from "./csv-parser.js";
import { parseXlsx } from "./xlsx-parser.js";

export type ParseOptions = {
  format: CatalogFormat;
  sheet?: string;
  maxSizeBytes?: number;
};

/**
 * Parse a supplier file into a normalized sheet representation.
 */
export async function parseFile(
  buffer: Buffer,
  options: ParseOptions,
): Promise<ParsedSheet> {
  switch (options.format) {
    case "csv":
      return parseCsv(buffer, { maxSizeBytes: options.maxSizeBytes });
    case "xlsx":
      return parseXlsx(buffer, {
        sheet: options.sheet,
        maxSizeBytes: options.maxSizeBytes,
      });
    default:
      throw new Error(`Unsupported format: ${options.format}`);
  }
}
