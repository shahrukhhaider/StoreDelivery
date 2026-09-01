/**
 * Mapping Engine — Section 8
 *
 * Orchestrates the mapping pipeline:
 * 1. Deterministic alias lookup
 * 2. Type inference
 * 3. Confidence assignment
 *
 * LLM inference (step 3 in the spec) is deferred to a separate module —
 * this engine handles the deterministic phases that Milestone A covers.
 */

import type { FieldMapping, TargetField, MappingConfidence } from "@shared/types/mapping.js";
import type { ParsedSheet } from "../parser/index.js";
import { lookupAlias } from "./aliases.js";
import { inferAllColumnTypes, type ColumnSample } from "./type-inference.js";
import { INFERENCE_SAMPLE_SIZE } from "@shared/constants.js";

export type MappingResult = {
  mappings: FieldMapping[];
  /** Columns that need merchant review */
  needsReview: string[];
  /** Columns that could not be mapped at all */
  unmapped: string[];
};

/**
 * Type → likely target field heuristic.
 * Used when alias lookup fails but type inference suggests a mapping.
 */
const TYPE_TO_TARGET: Record<string, TargetField> = {
  url: "image.url",
  barcode: "variant.barcode",
  currency: "variant.price",
};

/**
 * Run the full deterministic mapping pipeline on parsed sheet headers + sample data.
 */
export async function mapColumns(sheet: ParsedSheet): Promise<MappingResult> {
  const mappings: FieldMapping[] = [];
  const needsReview: string[] = [];
  const unmapped: string[] = [];

  // Track which target fields are already claimed to detect conflicts
  const claimedTargets = new Map<TargetField, string[]>();

  // Phase 1: Alias lookup for every header
  const aliasResults = new Map<
    string,
    { target: TargetField; imagePosition?: number } | null
  >();

  for (const header of sheet.headers) {
    aliasResults.set(header, lookupAlias(header));
  }

  // Phase 2: Type inference for all columns
  const samples: ColumnSample[] = sheet.headers.map((header) => ({
    header,
    values: sheet.rows
      .slice(0, INFERENCE_SAMPLE_SIZE)
      .map((row) => row[header] ?? ""),
  }));

  const typeResults = inferAllColumnTypes(samples);
  const typeByHeader = new Map(typeResults.map((r) => [r.header, r]));

  // Phase 3: Assign mappings
  for (const header of sheet.headers) {
    const alias = aliasResults.get(header);
    const typeInfo = typeByHeader.get(header);

    let targetField: TargetField | null = null;
    let confidence: MappingConfidence = "low";

    if (alias) {
      // Alias match — high confidence
      targetField = alias.target;
      confidence = "high";
    } else if (typeInfo && typeInfo.inferredType in TYPE_TO_TARGET) {
      // Type inference suggests a target — medium confidence
      targetField =
        TYPE_TO_TARGET[typeInfo.inferredType as keyof typeof TYPE_TO_TARGET];
      confidence = "medium";
    }

    if (targetField) {
      const existing = claimedTargets.get(targetField) ?? [];
      existing.push(header);
      claimedTargets.set(targetField, existing);
    }

    mappings.push({
      sourceColumn: header,
      targetField,
      confidence,
      mappingSource: targetField ? "rule" : "rule",
      ignored: false,
    });
  }

  // Phase 4: Detect conflicts — two columns mapped to the same non-repeatable target
  const repeatableTargets = new Set<TargetField>([
    "image.url",
    "product.tags",
    "ignore",
  ]);

  for (const [target, columns] of claimedTargets) {
    if (columns.length > 1 && !repeatableTargets.has(target)) {
      // Downgrade all conflicting mappings to medium + needs review
      for (const col of columns) {
        const mapping = mappings.find((m) => m.sourceColumn === col);
        if (mapping) {
          mapping.confidence = "medium";
        }
      }
      needsReview.push(...columns);
    }
  }

  // Phase 5: Mark medium-confidence and unmapped columns
  for (const mapping of mappings) {
    if (mapping.targetField === null) {
      unmapped.push(mapping.sourceColumn);
    } else if (
      mapping.confidence === "medium" &&
      !needsReview.includes(mapping.sourceColumn)
    ) {
      needsReview.push(mapping.sourceColumn);
    }
  }

  return { mappings, needsReview, unmapped };
}
