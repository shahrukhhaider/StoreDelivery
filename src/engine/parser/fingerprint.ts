/**
 * Schema Fingerprinting
 *
 * Generates a stable hash from sorted header names + delimiter + format.
 * Used to match saved mappings for repeat uploads from the same supplier.
 */

import { createHash } from "crypto";
import type { CatalogFormat } from "@shared/types/catalog.js";

/**
 * Generate a schema fingerprint from headers, delimiter, and format.
 * The fingerprint is stable regardless of header order.
 */
export function generateFingerprint(
  headers: string[],
  delimiter: string,
  format: CatalogFormat,
): string {
  const normalized = headers
    .map((h) => h.toLowerCase().trim())
    .sort()
    .join("|");

  const input = `${format}:${delimiter}:${normalized}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
