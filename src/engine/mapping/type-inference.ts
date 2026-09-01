/**
 * Column type inference — Section 8.2
 *
 * Examines sample values from a column to infer its likely data type.
 */

import type { InferredColumnType } from "@shared/types/mapping.js";

export type ColumnSample = {
  header: string;
  values: string[];
};

export type TypeInferenceResult = {
  header: string;
  inferredType: InferredColumnType;
  /** Fraction of non-empty values that matched the inferred type */
  matchRate: number;
};

/** Minimum fraction of non-empty values that must match for a type to be inferred */
const CONFIDENCE_THRESHOLD = 0.6;

// --- Type detectors ---

const CURRENCY_RE =
  /^[\s$€£¥₹₽₩฿₫₪₺₦R\s]*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?[\s$€£¥₹₽₩฿₫₪₺₦R\s]*$/;

const INTEGER_RE = /^-?\d{1,3}(?:[,.\s]\d{3})*$/;

const DECIMAL_RE = /^-?\d+[.,]\d+$/;

const URL_RE = /^https?:\/\//i;

// EAN-8 (8 digits), UPC-A (12 digits), EAN-13 (13 digits), GTIN-14 (14 digits)
const BARCODE_RE = /^\d{8}$|^\d{12,14}$/;

const BOOLEAN_VALUES = new Set([
  "true",
  "false",
  "yes",
  "no",
  "y",
  "n",
  "1",
  "0",
]);

function isCurrency(v: string): boolean {
  const trimmed = v.trim();
  // Must have a currency symbol OR a decimal portion to be considered currency
  // Bare integers like "100" should not match
  const hasCurrencySymbol = /[$€£¥₹₽₩฿₫₪₺₦R]/.test(trimmed);
  const hasDecimal = /\d[.,]\d{1,2}$/.test(trimmed);
  return CURRENCY_RE.test(trimmed) && /\d/.test(trimmed) && (hasCurrencySymbol || hasDecimal);
}

function isInteger(v: string): boolean {
  const cleaned = v.trim().replace(/[,.\s]/g, "");
  return INTEGER_RE.test(v.trim()) && /^\d+$/.test(cleaned);
}

function isDecimal(v: string): boolean {
  return DECIMAL_RE.test(v.trim());
}

function isUrl(v: string): boolean {
  return URL_RE.test(v.trim());
}

function isBarcode(v: string): boolean {
  return BARCODE_RE.test(v.trim());
}

function isBoolean(v: string): boolean {
  return BOOLEAN_VALUES.has(v.trim().toLowerCase());
}

type Detector = {
  type: InferredColumnType;
  test: (v: string) => boolean;
};

// Order matters — more specific types first
const DETECTORS: Detector[] = [
  { type: "url", test: isUrl },
  { type: "barcode", test: isBarcode },
  { type: "boolean", test: isBoolean },
  { type: "currency", test: isCurrency },
  { type: "integer", test: isInteger },
  { type: "decimal", test: isDecimal },
];

/**
 * Infer the most likely type for a column based on sample values.
 */
export function inferColumnType(sample: ColumnSample): TypeInferenceResult {
  const nonEmpty = sample.values.filter((v) => v.trim().length > 0);

  if (nonEmpty.length === 0) {
    return { header: sample.header, inferredType: "unknown", matchRate: 0 };
  }

  let bestType: InferredColumnType = "unknown";
  let bestRate = 0;

  for (const detector of DETECTORS) {
    const matches = nonEmpty.filter((v) => detector.test(v)).length;
    const rate = matches / nonEmpty.length;

    if (rate > bestRate && rate >= CONFIDENCE_THRESHOLD) {
      bestRate = rate;
      bestType = detector.type;
    }
  }

  // If nothing hit the threshold, check if it looks like free text vs category
  if (bestType === "unknown") {
    // Categories tend to repeat values; text tends to be unique
    const unique = new Set(nonEmpty.map((v) => v.trim().toLowerCase()));
    const uniqueRatio = unique.size / nonEmpty.length;

    if (uniqueRatio < 0.5 && nonEmpty.length >= 5) {
      bestType = "category";
      bestRate = 1 - uniqueRatio;
    } else {
      bestType = "text";
      bestRate = 1;
    }
  }

  return {
    header: sample.header,
    inferredType: bestType,
    matchRate: bestRate,
  };
}

/**
 * Infer types for all columns at once.
 */
export function inferAllColumnTypes(
  samples: ColumnSample[],
): TypeInferenceResult[] {
  return samples.map(inferColumnType);
}
