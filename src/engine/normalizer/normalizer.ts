/**
 * Value Normalizer
 *
 * Cleans and normalizes raw cell values before they enter the canonical model:
 * - Whitespace trimming/collapsing
 * - Currency symbol removal and decimal normalization
 * - European decimal format (comma → period)
 * - Boolean normalization
 * - Weight unit extraction
 * - Tag splitting
 */

// Common currency symbols to strip
const CURRENCY_SYMBOLS = /^[\s$€£¥₹₽₩฿₫₪₺₦R\s]+|[\s$€£¥₹₽₩฿₫₪₺₦R\s]+$/g;

// Regex for European-style number: 1.234,56 or 1234,56
const EUROPEAN_NUMBER = /^\d{1,3}(?:\.\d{3})*,\d{1,2}$/;

// Regex for US-style number: 1,234.56 or 1234.56
const US_NUMBER = /^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/;

// Bare decimal: 12.99 or 12,99 (short form, no thousands)
const BARE_DECIMAL = /^\d+[.,]\d{1,2}$/;

// Weight unit aliases
const WEIGHT_UNITS: Record<string, string> = {
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  kg: "kg",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
  g: "g",
  gram: "g",
  grams: "g",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
};

/**
 * Normalize a price string into a decimal string (e.g. "24.99").
 * Returns null if the value can't be interpreted as a price.
 */
export function normalizePrice(raw: string): string | null {
  if (!raw || raw.trim().length === 0) return null;

  let cleaned = raw.trim();

  // Strip currency symbols
  cleaned = cleaned.replace(CURRENCY_SYMBOLS, "").trim();

  // Handle common non-price indicators
  const lower = cleaned.toLowerCase();
  if (
    lower === "n/a" ||
    lower === "na" ||
    lower === "tbd" ||
    lower === "-" ||
    lower === "" ||
    lower === "free" ||
    lower === "call"
  ) {
    return null;
  }

  // Remove whitespace between digits
  cleaned = cleaned.replace(/\s/g, "");

  // European format: 1.234,56 → 1234.56
  if (EUROPEAN_NUMBER.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  }
  // Short European: 12,99 → 12.99
  else if (BARE_DECIMAL.test(cleaned) && cleaned.includes(",")) {
    cleaned = cleaned.replace(",", ".");
  }
  // US format: 1,234.56 → 1234.56
  else if (US_NUMBER.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, "");
  }

  // Final parse
  const num = parseFloat(cleaned);
  if (isNaN(num) || !isFinite(num)) return null;

  // Round to 2 decimal places
  return num.toFixed(2);
}

/**
 * Normalize an integer quantity string.
 * Returns null if the value can't be interpreted as an integer.
 */
export function normalizeInteger(raw: string): number | null {
  if (!raw || raw.trim().length === 0) return null;

  let cleaned = raw.trim();

  const lower = cleaned.toLowerCase();
  if (lower === "n/a" || lower === "na" || lower === "tbd" || lower === "-") {
    return null;
  }

  // Strip thousand separators
  cleaned = cleaned.replace(/,/g, "");

  // Strip any leading/trailing non-numeric except minus
  cleaned = cleaned.replace(/[^\d-]/g, "");

  const num = parseInt(cleaned, 10);
  if (isNaN(num) || !isFinite(num)) return null;

  return num;
}

/**
 * Normalize a weight value, optionally extracting the unit.
 */
export function normalizeWeight(
  raw: string,
): { value: number; unit: string } | null {
  if (!raw || raw.trim().length === 0) return null;

  const cleaned = raw.trim().toLowerCase();

  // Try to extract number and unit: "2.5 lbs", "2.5lbs", "2,5 kg"
  const match = cleaned.match(
    /^(\d+(?:[.,]\d+)?)\s*([a-z]+)?$/,
  );
  if (!match) return null;

  let numStr = match[1];
  const rawUnit = match[2] ?? "";

  // Handle European decimal
  if (numStr.includes(",")) {
    numStr = numStr.replace(",", ".");
  }

  const value = parseFloat(numStr);
  if (isNaN(value) || !isFinite(value)) return null;

  const unit = WEIGHT_UNITS[rawUnit] ?? (rawUnit || "lb");

  return { value, unit };
}

/**
 * Split a tags/keywords string into an array of trimmed, deduplicated tags.
 */
export function normalizeTags(raw: string): string[] {
  if (!raw || raw.trim().length === 0) return [];

  // Split on comma, semicolon, or pipe
  const parts = raw.split(/[,;|]/).map((t) => t.trim()).filter((t) => t.length > 0);

  // Deduplicate (case-insensitive, keep first occurrence's casing)
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of parts) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(tag);
    }
  }

  return result;
}

/**
 * Clean general text: trim, collapse whitespace, strip control chars.
 */
export function normalizeText(raw: string): string {
  if (!raw) return "";
  // Strip control characters (except newline/tab which we'll collapse)
  // eslint-disable-next-line no-control-regex
  let cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // Collapse whitespace
  cleaned = cleaned.trim().replace(/\s+/g, " ");
  return cleaned;
}
