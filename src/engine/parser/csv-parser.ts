/**
 * CSV Parser — Section 7
 *
 * Responsibilities:
 * - Detect delimiter (comma, tab, semicolon)
 * - Handle UTF-8 / UTF-8 BOM
 * - Parse quoted fields and embedded newlines
 * - Normalize whitespace
 * - Reject binary / empty / oversized files
 */

import { parse } from "csv-parse/sync";
import { ParseError } from "@shared/errors.js";
import { MAX_UPLOAD_SIZE_BYTES } from "@shared/constants.js";

export type ParsedSheet = {
  headers: string[];
  rows: Record<string, string>[];
  /** Detected delimiter character */
  delimiter: string;
  /** Total rows parsed (excluding header) */
  rowCount: number;
};

export type CsvParseOptions = {
  /** Override auto-detected delimiter */
  delimiter?: string;
  /** Max file size in bytes (default: 50MB) */
  maxSizeBytes?: number;
};

// UTF-8 BOM bytes
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * Parse a CSV buffer into a normalized sheet representation.
 */
export async function parseCsv(
  buffer: Buffer,
  options?: CsvParseOptions,
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

  // Check for binary data — look for null bytes in first 1KB
  const sampleEnd = Math.min(buffer.length, 1024);
  for (let i = 0; i < sampleEnd; i++) {
    if (buffer[i] === 0x00) {
      throw new ParseError(
        "File appears to be binary data, not a text CSV",
        "BINARY_FILE",
      );
    }
  }

  // Strip UTF-8 BOM if present
  let content: string;
  if (buffer.length >= 3 && buffer[0] === BOM[0] && buffer[1] === BOM[1] && buffer[2] === BOM[2]) {
    content = buffer.subarray(3).toString("utf-8");
  } else {
    content = buffer.toString("utf-8");
  }

  if (content.trim().length === 0) {
    throw new ParseError("File contains no data after trimming", "EMPTY_FILE");
  }

  const delimiter = options?.delimiter ?? detectDelimiter(content);

  const records: string[][] = parse(content, {
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  });

  if (records.length === 0) {
    throw new ParseError("No rows found in CSV", "NO_ROWS");
  }

  if (records.length === 1) {
    throw new ParseError(
      "CSV has a header row but no data rows",
      "NO_DATA_ROWS",
    );
  }

  // First row is headers — normalize whitespace
  const rawHeaders = records[0];
  const headers = rawHeaders.map(normalizeHeaderCell);

  // Check for completely empty headers (every header blank)
  if (headers.every((h) => h === "")) {
    throw new ParseError("No recognizable headers found", "NO_HEADERS");
  }

  // Build row objects
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    // Skip completely blank rows
    if (row.every((cell) => cell.trim() === "")) {
      continue;
    }

    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j] || `_column_${j}`;
      obj[header] = normalizeCell(row[j] ?? "");
    }
    rows.push(obj);
  }

  if (rows.length === 0) {
    throw new ParseError("All data rows are empty", "NO_DATA_ROWS");
  }

  return {
    headers: headers.map((h, i) => h || `_column_${i}`),
    rows,
    delimiter,
    rowCount: rows.length,
  };
}

/**
 * Detect the most likely delimiter by sampling the first N lines.
 *
 * Scores each candidate by how consistent the column count is across lines.
 * The delimiter that produces the most consistent, highest column count wins.
 */
export function detectDelimiter(content: string): string {
  const candidates = [",", "\t", ";"];
  const sampleLines = content.split("\n").slice(0, 20).filter((l) => l.trim().length > 0);

  if (sampleLines.length === 0) {
    return ",";
  }

  let bestDelimiter = ",";
  let bestScore = -1;

  for (const delim of candidates) {
    const counts = sampleLines.map((line) => countDelimiter(line, delim));

    // Skip if delimiter never appears
    if (counts.every((c) => c === 0)) {
      continue;
    }

    // Score = median column count * consistency
    // Consistency = fraction of lines with the same count as the first line
    const firstCount = counts[0];
    const matchingLines = counts.filter((c) => c === firstCount).length;
    const consistency = matchingLines / counts.length;
    const score = (firstCount + 1) * consistency;

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delim;
    }
  }

  return bestDelimiter;
}

/**
 * Count occurrences of a delimiter in a line, respecting quoted fields.
 */
function countDelimiter(line: string, delim: string): number {
  let count = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      count++;
    }
  }

  return count;
}

function normalizeHeaderCell(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function normalizeCell(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}
