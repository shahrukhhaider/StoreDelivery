/**
 * Express middleware — error handling, request logging, shop scoping.
 */

import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { getLogger } from "../logger.js";
import { ZodError } from "zod";

/**
 * Request logging middleware.
 */
export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  const logger = getLogger();
  logger.info(`${req.method} ${req.path}`, {
    query: req.query,
    ip: req.ip,
  });
  next();
}

/**
 * Extract shop ID from request header or query.
 * In V0 dev mode, uses X-Shop-Id header. In production, will come from Shopify session.
 */
export function shopScope(req: Request, res: Response, next: NextFunction): void {
  const shopId =
    (req.headers["x-shop-id"] as string) ||
    (req.query.shopId as string) ||
    "dev_shop";

  (req as Request & { shopId: string }).shopId = shopId;
  next();
}

/**
 * Global error handler.
 */
export const errorHandler: ErrorRequestHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const logger = getLogger();

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Invalid request data",
      details: err.errors,
    });
    return;
  }

  logger.error("Unhandled error", { error: err.message, stack: err.stack });

  res.status(500).json({
    error: "INTERNAL_ERROR",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "An unexpected error occurred",
  });
};

/**
 * Typed request with shopId.
 */
export interface ShopRequest extends Request {
  shopId: string;
}

/**
 * Helper to extract shopId from request (set by shopScope middleware).
 */
export function getShopId(req: Request): string {
  return (req as unknown as ShopRequest).shopId ?? "dev_shop";
}
