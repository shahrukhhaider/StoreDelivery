/**
 * End-to-end catalog processing pipeline.
 *
 * parse → map (alias → type → LLM) → group → validate → return Catalog
 *
 * This is the main entry point for processing a supplier file
 * into the canonical catalog representation.
 */

import type { Catalog, CatalogFormat } from "@shared/types/catalog.js";
import type { FieldMapping } from "@shared/types/mapping.js";
import { parseFile, type ParsedSheet } from "./parser/index.js";
import { generateFingerprint } from "./parser/fingerprint.js";
import { mapColumns, type MappingResult, type MappingOptions } from "./mapping/index.js";
import type { LlmInferenceConfig } from "./mapping/index.js";
import { groupRows } from "./grouping/index.js";
import { validateCatalog } from "./validation/index.js";
import { nanoid } from "nanoid";

export type PipelineOptions = {
  /** File format */
  format: CatalogFormat;
  /** XLSX sheet name if applicable */
  sheet?: string;
  /** Max file size in bytes */
  maxSizeBytes?: number;
  /** Shop ID for the catalog */
  shopId: string;
  /** Upload ID to link back to the upload record */
  uploadId: string;
  /** Original file name */
  fileName: string;
  /** Pre-existing mappings to use instead of auto-detection */
  existingMappings?: FieldMapping[];
  /** LLM config for mapping inference on unmapped columns */
  llm?: LlmInferenceConfig;
};

export type PipelineResult = {
  catalog: Catalog;
  /** The parsed sheet (useful for UI preview) */
  sheet: ParsedSheet;
  /** The mapping result (useful for UI review) */
  mappingResult: MappingResult;
};

/**
 * Process a supplier file through the full offline pipeline.
 */
export async function processCatalog(
  buffer: Buffer,
  options: PipelineOptions,
): Promise<PipelineResult> {
  // Step 1: Parse
  const sheet = await parseFile(buffer, {
    format: options.format,
    sheet: options.sheet,
    maxSizeBytes: options.maxSizeBytes,
  });

  // Step 2: Map columns
  let mappingResult: MappingResult;

  if (options.existingMappings && options.existingMappings.length > 0) {
    // Use provided mappings
    mappingResult = {
      mappings: options.existingMappings,
      needsReview: options.existingMappings
        .filter((m) => m.confidence === "medium")
        .map((m) => m.sourceColumn),
      unmapped: options.existingMappings
        .filter((m) => m.targetField === null)
        .map((m) => m.sourceColumn),
    };
  } else {
    const mappingOpts: MappingOptions = {};
    if (options.llm) {
      mappingOpts.llm = options.llm;
    }
    mappingResult = await mapColumns(sheet, mappingOpts);
  }

  // Step 3: Group rows into products/variants
  const { products, ambiguousGroups } = groupRows(
    sheet,
    mappingResult.mappings,
  );

  // Step 4: Validate
  const validationResult = validateCatalog(products);

  // Step 4b: Convert ambiguous groups into validation warnings
  for (const group of ambiguousGroups) {
    validationResult.issues.push({
      severity: "warning",
      code: "AMBIGUOUS_GROUPING",
      message: `"${group.proposedTitle}" has ${group.rowIndices.length} rows grouped as variants — ${group.reason}. Consider mapping a parent key or option column.`,
      sourceKey: group.proposedTitle,
      field: "options",
    });
    validationResult.warningCount++;
  }

  // Step 5: Build fingerprint
  const fingerprint = generateFingerprint(
    sheet.headers,
    sheet.delimiter,
    options.format,
  );

  // Step 6: Assemble catalog
  const catalog: Catalog = {
    id: nanoid(),
    shopId: options.shopId,
    uploadId: options.uploadId,
    source: {
      fileName: options.fileName,
      format: options.format,
      sheet: options.sheet,
      schemaFingerprint: fingerprint,
    },
    products,
    issues: validationResult.issues,
  };

  return { catalog, sheet, mappingResult };
}
