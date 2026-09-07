/**
 * Issue classification and filtering — used by the edit API tabs.
 *
 * Extracted to a testable module so the core filtering logic
 * doesn't live only in the API route handler.
 */

import type { CatalogIssue } from "@shared/types/catalog.js";

export type IssueType =
  | "missing_value"
  | "duplicate"
  | "invalid_value"
  | "variant_grouping"
  | "image"
  | "other";

/**
 * Classify an issue code into an issue type for tab filtering.
 */
export function classifyIssueType(code: string): IssueType {
  if (code.includes("MISSING")) return "missing_value";
  if (code.includes("DUPLICATE")) return "duplicate";
  if (code.includes("IMAGE")) return "image";
  if (code.includes("MALFORMED") || code.includes("INVALID") || code.includes("SUSPICIOUS")) return "invalid_value";
  if (code.includes("VARIANT") || code.includes("NO_VARIANTS") || code.includes("EMPTY_OPTION")) return "variant_grouping";
  return "other";
}

/**
 * Filter issues by severity and/or type.
 */
export function filterIssues(
  issues: CatalogIssue[],
  filters: { severity?: string; type?: string },
): CatalogIssue[] {
  let filtered = issues;
  if (filters.severity) {
    filtered = filtered.filter((i) => i.severity === filters.severity);
  }
  if (filters.type) {
    filtered = filtered.filter((i) => classifyIssueType(i.code) === filters.type);
  }
  return filtered;
}

/**
 * Get source keys of products affected by filtered issues.
 */
export function getAffectedKeys(
  issues: CatalogIssue[],
  filters: { severity?: string; type?: string },
): Set<string> {
  const filtered = filterIssues(issues, filters);
  const keys = new Set<string>();
  for (const issue of filtered) {
    if (issue.sourceKey) keys.add(issue.sourceKey);
  }
  return keys;
}

/**
 * Count issues by type and severity.
 */
export function countIssues(issues: CatalogIssue[]): {
  typeCounts: Record<string, number>;
  severityCounts: Record<string, number>;
} {
  const typeCounts: Record<string, number> = {};
  const severityCounts: Record<string, number> = {};
  for (const issue of issues) {
    const t = classifyIssueType(issue.code);
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    severityCounts[issue.severity] = (severityCounts[issue.severity] ?? 0) + 1;
  }
  return { typeCounts, severityCounts };
}
