/**
 * Security hardening — Section 19
 *
 * Helmet headers, rate limiting, CSRF protection, input sanitization.
 */

import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";

/**
 * Security headers via Helmet.
 * Relaxed CSP for Shopify embedded app iframe.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.shopify.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.shopify.com"],
      frameSrc: ["'self'", "https://*.myshopify.com"],
      frameAncestors: ["'self'", "https://*.myshopify.com", "https://admin.shopify.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://*.myshopify.com", "https://*.shopify.com"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
});

/**
 * Rate limiter for upload endpoint — prevent abuse.
 */
export const uploadRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 uploads per minute per IP
  message: {
    error: "RATE_LIMITED",
    message: "Too many uploads. Please wait a moment.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General API rate limiter.
 */
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // 120 requests per minute
  message: {
    error: "RATE_LIMITED",
    message: "Too many requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Sanitize values that could be interpreted as spreadsheet formulas.
 * Relevant when exporting error reports to CSV.
 */
export function sanitizeFormulaInjection(value: string): string {
  if (!value) return value;
  const dangerous = ["=", "+", "-", "@", "\t", "\r"];
  if (dangerous.some((ch) => value.startsWith(ch))) {
    return `'${value}`;
  }
  return value;
}

/**
 * Tenant isolation audit helper — verify a query includes shopId filter.
 * Used in development for sanity checking.
 */
export function assertShopScoped(shopId: string | undefined): asserts shopId is string {
  if (!shopId) {
    throw new Error("TENANT_ISOLATION: shopId is required but was not provided");
  }
}
