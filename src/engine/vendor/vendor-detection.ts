/**
 * Vendor Detection — pure function, no DB access.
 *
 * Infers which VendorProfile a catalog belongs to from:
 *   1. Schema fingerprint match (strongest — same file structure as a known vendor)
 *   2. Mapped vendor column value matching an existing vendor name (HIGH if exact, MEDIUM if partial)
 *   3. No signal → NONE, merchant must confirm
 *
 * Returns a VendorDetectionResult the caller uses to decide whether to
 * auto-resolve or prompt the merchant for vendor selection.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KnownVendor = {
  id: string;
  name: string;
  normalizedName: string;
  schemaFingerprint: string | null;
};

export type VendorDetectionResult = {
  confidence: "HIGH" | "MEDIUM" | "NONE";
  /** ID of the matched VendorProfile — null when confidence is NONE. */
  matchedVendorId: string | null;
  matchedVendorName: string | null;
  /**
   * Vendor name candidate extracted from the file itself (product.vendor values).
   * Used to pre-fill the "Create new vendor" input even when no match is found.
   */
  candidateVendorName: string | null;
  /** Which signal triggered the match. */
  matchSource: "schema_fingerprint" | "vendor_column_exact" | "vendor_column_partial" | "none";
};

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Detect the vendor for a catalog from available signals.
 *
 * @param schemaFingerprint - Hash of the current file's column structure.
 * @param productVendorValues - Unique vendor values found in the normalized products.
 * @param knownVendors - All VendorProfiles for this shop (loaded by the caller).
 */
export function detectVendor(
  schemaFingerprint: string | null,
  productVendorValues: string[],
  knownVendors: KnownVendor[],
): VendorDetectionResult {
  // -------------------------------------------------------------------------
  // Signal 1 — Schema fingerprint (strongest: exact structural match)
  // -------------------------------------------------------------------------
  if (schemaFingerprint) {
    const fpMatch = knownVendors.find(
      (v) => v.schemaFingerprint && v.schemaFingerprint === schemaFingerprint,
    );
    if (fpMatch) {
      return {
        confidence: "HIGH",
        matchedVendorId: fpMatch.id,
        matchedVendorName: fpMatch.name,
        candidateVendorName: fpMatch.name,
        matchSource: "schema_fingerprint",
      };
    }
  }

  // -------------------------------------------------------------------------
  // Signal 2 — Vendor column exact match
  // -------------------------------------------------------------------------
  const candidateName = extractCandidateName(productVendorValues);

  if (candidateName) {
    const candidateNormalized = normalizeVendorName(candidateName);

    // Exact normalized match
    const exactMatch = knownVendors.find(
      (v) => v.normalizedName === candidateNormalized,
    );
    if (exactMatch) {
      return {
        confidence: "HIGH",
        matchedVendorId: exactMatch.id,
        matchedVendorName: exactMatch.name,
        candidateVendorName: candidateName,
        matchSource: "vendor_column_exact",
      };
    }

    // Partial match — candidate normalized name contains or is contained by a known vendor slug
    const partialMatch = knownVendors.find(
      (v) =>
        v.normalizedName.includes(candidateNormalized) ||
        candidateNormalized.includes(v.normalizedName),
    );
    if (partialMatch) {
      return {
        confidence: "MEDIUM",
        matchedVendorId: partialMatch.id,
        matchedVendorName: partialMatch.name,
        candidateVendorName: candidateName,
        matchSource: "vendor_column_partial",
      };
    }
  }

  // -------------------------------------------------------------------------
  // No signal — merchant must select/create
  // -------------------------------------------------------------------------
  return {
    confidence: "NONE",
    matchedVendorId: null,
    matchedVendorName: null,
    candidateVendorName: candidateName,
    matchSource: "none",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the most representative vendor name from a list of product.vendor values.
 * If all products share the same vendor, returns that value.
 * If values differ, returns the most frequent one (or null if no clear winner).
 */
export function extractCandidateName(vendorValues: string[]): string | null {
  const nonempty = vendorValues.map((v) => v.trim()).filter(Boolean);
  if (nonempty.length === 0) return null;

  // Count occurrences
  const counts = new Map<string, number>();
  for (const v of nonempty) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }

  // Find the most frequent
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }

  // Only return if it represents a clear majority (>50% of non-empty values)
  if (best && bestCount > nonempty.length / 2) return best;

  // If all values are the same, return it regardless
  if (counts.size === 1) return best;

  return null;
}

/**
 * Normalise a vendor name to a URL-safe slug.
 * "Acme Distribution Ltd." → "acme-distribution-ltd"
 */
export function normalizeVendorName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
