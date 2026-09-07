/**
 * Shopify Catalog Sync API — bootstrap sync and status.
 *
 * POST /api/shopify/sync — Trigger a full catalog sync
 * GET  /api/shopify/sync/status — Check sync status
 */

import { Router } from "express";
import { getPrisma } from "../db.js";
import { getLogger } from "../logger.js";
import { getShopId } from "./middleware.js";
import { ShopifyGraphQLClient } from "../shopify/graphql-client.js";
import { getAccessToken } from "../shopify/auth.js";
import { syncShopifyCatalog, getSyncStatus } from "../shopify/catalog-sync.js";

const router = Router();

/**
 * POST /api/shopify/sync — Trigger a full Shopify catalog sync.
 *
 * Fetches all products/variants from Shopify and persists a local
 * snapshot for reconciliation matching.
 */
router.post("/sync", async (req, res, next) => {
  try {
    const shopId = getShopId(req);
    const logger = getLogger();
    const prisma = getPrisma();

    // Check if a sync is already in progress
    const existingSync = await prisma.shopifyCatalogSync.findFirst({
      where: { shopId, status: "SYNCING" },
    });

    if (existingSync) {
      res.status(409).json({
        error: "SYNC_IN_PROGRESS",
        message: "A sync is already in progress",
        syncId: existingSync.id,
      });
      return;
    }

    // Get Shopify access token
    const shop = await prisma.shop.findFirst({
      where: { id: shopId },
      select: { shopDomain: true },
    });

    if (!shop) {
      res.status(404).json({ error: "SHOP_NOT_FOUND" });
      return;
    }

    const accessToken = await getAccessToken(shop.shopDomain);
    if (!accessToken) {
      res.status(401).json({
        error: "NO_ACCESS_TOKEN",
        message: "No Shopify access token available for this shop",
      });
      return;
    }

    const client = new ShopifyGraphQLClient({
      shopDomain: shop.shopDomain,
      accessToken,
    });

    logger.info("Shopify catalog sync requested", { shopId });

    // Run sync asynchronously — return immediately
    const syncPromise = syncShopifyCatalog(shopId, client);

    // Fire and forget — the sync updates its own status in DB
    syncPromise.catch((err) => {
      logger.error("Shopify catalog sync error", {
        shopId,
        error: (err as Error).message,
      });
    });

    // Return the sync status (will be SYNCING)
    const status = await getSyncStatus(shopId);

    res.status(202).json({
      message: "Sync started",
      ...status,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/shopify/sync/status — Check current sync status.
 */
router.get("/sync/status", async (req, res, next) => {
  try {
    const shopId = getShopId(req);
    const status = await getSyncStatus(shopId);

    res.json(status);
  } catch (err) {
    next(err);
  }
});

export { router as syncRouter };
