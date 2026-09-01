/**
 * Engine barrel export.
 *
 * The engine is the pure-logic core — no DB, no HTTP, no Shopify.
 * It handles: parsing → mapping → grouping → normalization → validation.
 */

export * from "./parser/index.js";
export * from "./mapping/index.js";
export * from "./grouping/index.js";
export * from "./validation/index.js";
export * from "./normalizer/index.js";
export { processCatalog } from "./pipeline.js";
export type { PipelineOptions, PipelineResult } from "./pipeline.js";
