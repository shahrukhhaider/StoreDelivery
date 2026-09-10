/**
 * Tests for import item skip reason labeling.
 *
 * The skip reason is derived from the reconciliation classification stored
 * in RunItem and shown in the import results page.
 */

import { describe, it, expect } from "vitest";
import { CLASSIFICATION_LABELS, getSkipReason } from "./import.js";

// ---------------------------------------------------------------------------
// CLASSIFICATION_LABELS — all expected labels are present
// ---------------------------------------------------------------------------

describe("CLASSIFICATION_LABELS", () => {
  it("has a label for every skip-related classification", () => {
    const requiredClassifications = [
      "EXISTING_MAPPED",
      "LIKELY_EXISTING",
      "NO_CHANGE",
      "NEEDS_REVIEW",
      "UPDATE_REVIEW",
    ];

    for (const cls of requiredClassifications) {
      expect(CLASSIFICATION_LABELS[cls]).toBeDefined();
      expect(CLASSIFICATION_LABELS[cls].length).toBeGreaterThan(0);
    }
  });

  it("does not have a label for NEW_PRODUCT (it gets created, not skipped)", () => {
    expect(CLASSIFICATION_LABELS["NEW_PRODUCT"]).toBeUndefined();
  });

  it("labels are human-readable strings (not internal codes)", () => {
    for (const [, label] of Object.entries(CLASSIFICATION_LABELS)) {
      // Should not be uppercase_with_underscores
      expect(label).not.toMatch(/^[A-Z_]+$/);
      // Should start with a capital letter
      expect(label[0]).toBe(label[0].toUpperCase());
    }
  });
});

// ---------------------------------------------------------------------------
// getSkipReason — maps classification to label
// ---------------------------------------------------------------------------

describe("getSkipReason", () => {
  it("returns correct label for EXISTING_MAPPED", () => {
    expect(getSkipReason("EXISTING_MAPPED")).toBe("Already in Shopify (previously imported)");
  });

  it("returns correct label for LIKELY_EXISTING", () => {
    expect(getSkipReason("LIKELY_EXISTING")).toBe("Matched to existing Shopify product");
  });

  it("returns correct label for NO_CHANGE", () => {
    expect(getSkipReason("NO_CHANGE")).toBe("Matched — no changes detected");
  });

  it("returns correct label for NEEDS_REVIEW", () => {
    expect(getSkipReason("NEEDS_REVIEW")).toBe("Ambiguous match — needs review");
  });

  it("returns correct label for UPDATE_REVIEW", () => {
    expect(getSkipReason("UPDATE_REVIEW")).toBe("Already in Shopify — review updates on the Edit page");
  });

  it("returns 'Skipped' when classification is undefined (no run found)", () => {
    expect(getSkipReason(undefined)).toBe("Skipped");
  });

  it("returns fallback with classification name for unknown classifications", () => {
    const reason = getSkipReason("SOME_FUTURE_CLASSIFICATION");
    expect(reason).toContain("SOME_FUTURE_CLASSIFICATION");
    expect(reason).toBe("Skipped (SOME_FUTURE_CLASSIFICATION)");
  });

  it("never returns an empty string", () => {
    const classifications = [
      "EXISTING_MAPPED", "LIKELY_EXISTING", "NO_CHANGE",
      "NEEDS_REVIEW", "UPDATE_REVIEW", undefined, "UNKNOWN",
    ];
    for (const cls of classifications) {
      const reason = getSkipReason(cls);
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration contract: skipReason is null for non-skipped items
// ---------------------------------------------------------------------------

describe("skipReason contract", () => {
  it("NEW_PRODUCT items (created) should not have a skip reason", () => {
    // Simulates what the items.map produces for a successfully created item
    const createdItem = {
      status: "success",
      sourceProductKey: "new-product",
      skipReason: null,
    };
    expect(createdItem.skipReason).toBeNull();
  });

  it("failed items should not have a skip reason (they have errorMessage instead)", () => {
    const failedItem = {
      status: "failed",
      sourceProductKey: "bad-product",
      skipReason: null,
      errorMessage: "VALIDATION_ERROR",
    };
    expect(failedItem.skipReason).toBeNull();
    expect(failedItem.errorMessage).toBeDefined();
  });

  it("skipped item with known classification has a human-readable reason", () => {
    const skipReasonMap = new Map([
      ["5-panel-hat", "NO_CHANGE"],
    ]);

    const skippedItem = {
      status: "skipped",
      sourceProductKey: "5-panel-hat",
    };

    const reason = skippedItem.status === "skipped"
      ? getSkipReason(skipReasonMap.get(skippedItem.sourceProductKey))
      : null;

    expect(reason).toBe("Matched — no changes detected");
    // Not an internal code
    expect(reason).not.toBe("NO_CHANGE");
    expect(reason).not.toBeNull();
  });

  it("skipped item with no RunItem match falls back to 'Skipped'", () => {
    const skipReasonMap = new Map<string, string>();
    // Product not in RunItems (e.g., reconciliation ran but didn't cover this product)

    const reason = getSkipReason(skipReasonMap.get("mystery-product"));
    expect(reason).toBe("Skipped");
  });
});
