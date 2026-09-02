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
 * Ensures the shop record exists in DB (creates if needed for dev mode).
 */
export function shopScope(req: Request, _res: Response, next: NextFunction): void {
  const shopId =
    (req.headers["x-shop-id"] as string) ||
    (req.query.shopId as string) ||
    "dev_shop";

  (req as Request & { shopId: string }).shopId = shopId;

  // Ensure shop record exists (lazy upsert)
  ensureShopExists(shopId).then(() => next()).catch(next);
}

const ensuredShops = new Set<string>();

async function ensureShopExists(shopId: string): Promise<void> {
  if (ensuredShops.has(shopId)) return;

  const { getPrisma } = await import("../db.js");
  const prisma = getPrisma();

  await prisma.shop.upsert({
    where: { id: shopId },
    create: {
      id: shopId,
      shopDomain: shopId === "dev_shop" ? "dev.myshopify.com" : `${shopId}.myshopify.com`,
      encryptedAccessToken: "dev-token",
      scopes: "write_products,read_products",
    },
    update: {},
  });

  ensuredShops.add(shopId);
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
