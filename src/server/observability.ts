/**
 * Observability — structured metrics tracking.
 *
 * Simple in-memory counters + winston logging for V0.
 * Can be replaced with Prometheus/DataDog/CloudWatch in production.
 */

import { getLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Metric counters
// ---------------------------------------------------------------------------

const counters: Record<string, number> = {};

export function incrementCounter(name: string, amount = 1): void {
  counters[name] = (counters[name] ?? 0) + amount;
}

export function getCounter(name: string): number {
  return counters[name] ?? 0;
}

export function getAllCounters(): Record<string, number> {
  return { ...counters };
}

// ---------------------------------------------------------------------------
// Histograms (track durations)
// ---------------------------------------------------------------------------

const histograms: Record<string, number[]> = {};

export function recordDuration(name: string, ms: number): void {
  if (!histograms[name]) histograms[name] = [];
  histograms[name].push(ms);
  // Keep last 1000 samples
  if (histograms[name].length > 1000) {
    histograms[name] = histograms[name].slice(-1000);
  }
}

export function getHistogramStats(name: string): {
  count: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
} | null {
  const samples = histograms[name];
  if (!samples || samples.length === 0) return null;

  const sorted = [...samples].sort((a, b) => a - b);
  const count = sorted.length;
  const avg = sorted.reduce((a, b) => a + b, 0) / count;
  const p50 = sorted[Math.floor(count * 0.5)];
  const p95 = sorted[Math.floor(count * 0.95)];
  const p99 = sorted[Math.floor(count * 0.99)];

  return { count, avg, p50, p95, p99 };
}

// ---------------------------------------------------------------------------
// Pre-defined metric names
// ---------------------------------------------------------------------------

export const Metrics = {
  UPLOAD_SUCCESS: "upload.success",
  UPLOAD_FAILURE: "upload.failure",
  PARSE_SUCCESS: "parse.success",
  PARSE_FAILURE: "parse.failure",
  PARSE_DURATION: "parse.duration_ms",
  MAPPING_HIGH_CONFIDENCE: "mapping.high_confidence",
  MAPPING_MEDIUM_CONFIDENCE: "mapping.medium_confidence",
  MAPPING_LOW_CONFIDENCE: "mapping.low_confidence",
  MAPPING_MANUAL_REMAP: "mapping.manual_remap",
  VALIDATION_BLOCKING: "validation.blocking",
  VALIDATION_WARNING: "validation.warning",
  DUPLICATE_DETECTED: "duplicate.detected",
  SHOPIFY_MUTATION_SUCCESS: "shopify.mutation.success",
  SHOPIFY_MUTATION_FAILURE: "shopify.mutation.failure",
  SHOPIFY_RATE_LIMIT: "shopify.rate_limit",
  IMPORT_COMPLETED: "import.completed",
  IMPORT_FAILED: "import.failed",
  IMPORT_PRODUCTS_CREATED: "import.products_created",
} as const;

// ---------------------------------------------------------------------------
// Metrics API endpoint
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";

export function metricsHandler(_req: Request, res: Response): void {
  res.json({
    counters: getAllCounters(),
    histograms: Object.fromEntries(
      Object.entries(histograms).map(([name]) => [name, getHistogramStats(name)]),
    ),
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Timer utility
// ---------------------------------------------------------------------------

export function startTimer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}
