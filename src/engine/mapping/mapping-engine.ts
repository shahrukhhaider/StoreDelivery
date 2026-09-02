/**
 * Mapping Engine — Section 8
 *
 * Orchestrates the mapping pipeline:
 * 1. Deterministic alias lookup
 * 2. Type inference
 * 3. LLM inference (only for unresolved columns)
 * 4. Confidence assignment + conflict detection
 */

import type { FieldMapping, TargetField, MappingConfidence } from "@shared/types/mapping.js";
import type { ParsedSheet } from "../parser/index.js";
import { lookupAlias } from "./aliases.js";
import { inferAllColumnTypes, type ColumnSample } from "./type-inference.js";
import { inferColumnsWithLlm, type LlmInferenceConfig } from "./llm-inference.js";
import { INFERENCE_SAMPLE_SIZE } from "@shared/constants.js";

export type MappingOptions = {
  /** LLM config — if not provided or provider is "none", LLM step is skipped */
  llm?: LlmInferenceConfig;
};

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
 * Run the full mapping pipeline on parsed sheet headers + sample data.
 */
export async function mapColumns(
  sheet: ParsedSheet,
  options?: MappingOptions,
): Promise<MappingResult> {
  const mappings: FieldMapping[] = [];
  const needsReview: string[] = [];
  const unmapped: string[] = [];

  // Track which target fields are already claimed to detect conflicts
  const claimedTargets = new Map<TargetField, string[]>();

  // Build sample data for inference
  const samples: ColumnSample[] = sheet.headers.map((header) => ({
    header,
    values: sheet.rows
      .slice(0, INFERENCE_SAMPLE_SIZE)
      .map((row) => row[header] ?? ""),
  }));

  // Phase 1: Alias lookup for every header
  const aliasResults = new Map<
    string,
    { target: TargetField; imagePosition?: number } | null
  >();

  for (const header of sheet.headers) {
    aliasResults.set(header, lookupAlias(header));
  }

  // Phase 2: Type inference for all columns
  const typeResults = inferAllColumnTypes(samples);
  const typeByHeader = new Map(typeResults.map((r) => [r.header, r]));

  // Phase 3: LLM inference for columns not resolved by alias or type
  const unresolvedHeaders: string[] = [];
  for (const header of sheet.headers) {
    const alias = aliasResults.get(header);
    const typeInfo = typeByHeader.get(header);
    const typeResolved = typeInfo && typeInfo.inferredType in TYPE_TO_TARGET;
    if (!alias && !typeResolved) {
      unresolvedHeaders.push(header);
    }
  }

  const llmResults = new Map<string, TargetField | null>();

  if (unresolvedHeaders.length > 0 && options?.llm && options.llm.provider !== "none") {
    const llmRequests = unresolvedHeaders.map((header) => {
      const idx = sheet.headers.indexOf(header);
      const neighborHeaders = sheet.headers
        .slice(Math.max(0, idx - 2), idx + 3)
        .filter((h) => h !== header);
      const sample = samples.find((s) => s.header === header);
      return {
        header,
        neighborHeaders,
        sampleValues: sample?.values.filter((v) => v.trim() !== "").slice(0, 10) ?? [],
      };
    });

    const results = await inferColumnsWithLlm(llmRequests, options.llm);
    for (const result of results) {
      llmResults.set(result.header, result.suggestedTarget);
    }
  }

  // Phase 4: Assign mappings (alias → type → LLM → unmapped)
  for (const header of sheet.headers) {
    const alias = aliasResults.get(header);
    const typeInfo = typeByHeader.get(header);
    const llmSuggestion = llmResults.get(header);

    let targetField: TargetField | null = null;
    let confidence: MappingConfidence = "low";
    let source: "rule" | "model" = "rule";

    if (alias) {
      // Alias match — high confidence
      targetField = alias.target;
      confidence = "high";
      source = "rule";
    } else if (typeInfo && typeInfo.inferredType in TYPE_TO_TARGET) {
      // Type inference suggests a target — medium confidence
      targetField =
        TYPE_TO_TARGET[typeInfo.inferredType as keyof typeof TYPE_TO_TARGET];
      confidence = "medium";
      source = "rule";
    } else if (llmSuggestion) {
      // LLM suggestion — medium confidence, always needs review
      targetField = llmSuggestion;
      confidence = "medium";
      source = "model";
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
      mappingSource: source,
      ignored: false,
    });
  }

  // Phase 5: Detect conflicts — two columns mapped to the same non-repeatable target
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

  // Phase 6: Mark medium-confidence and unmapped columns
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
