/**
 * Shopify Compliance Webhooks — mandatory data handling.
 *
 * Required endpoints for App Store submission:
 * - customers/data_request
 * - customers/redact
 * - shop/redact
 */

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { getPrisma } from "../db.js";
import { getStorage } from "../storage/file-storage.js";
import { getConfig } from "../config.js";
import { getLogger } from "../logger.js";

const router = Router();

/**
 * Verify Shopify webhook HMAC signature.
 */
function verifyWebhook(req: Request): boolean {
  const config = getConfig();
  if (!config.shopifyApiSecret) return true; // Dev mode

  const hmac = req.headers["x-shopify-hmac-sha256"] as string;
  if (!hmac) return false;

  // Note: requires raw body — use express.raw() for webhook routes
  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const expected = crypto
    .createHmac("sha256", config.shopifyApiSecret)
    .update(body)
    .digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(hmac),
    Buffer.from(expected),
  );
}

/**
 * POST /webhooks/customers/data_request
 *
 * Shopify sends this when a customer requests their data.
 * V0 does not store customer data — respond with empty payload.
 */
router.post("/customers/data_request", (req: Request, res: Response) => {
  const logger = getLogger();

  if (!verifyWebhook(req)) {
    res.status(401).send("Unauthorized");
    return;
  }

  logger.info("Customer data request received", {
    shop: req.headers["x-shopify-shop-domain"],
  });

  // V0 does not store customer data — nothing to return
  res.status(200).json({
    message: "This app does not store customer data.",
  });
});

/**
 * POST /webhooks/customers/redact
 *
 * Shopify sends this when a store owner requests deletion of customer data.
 * V0 does not store customer data — acknowledge and no-op.
 */
router.post("/customers/redact", (req: Request, res: Response) => {
  const logger = getLogger();

  if (!verifyWebhook(req)) {
    res.status(401).send("Unauthorized");
    return;
  }

  logger.info("Customer redact request received", {
    shop: req.headers["x-shopify-shop-domain"],
  });

  // V0 does not store customer data
  res.status(200).json({
    message: "No customer data to redact.",
  });
});

/**
 * POST /webhooks/shop/redact
 *
 * Shopify sends this 48 hours after app uninstall to request data deletion.
 * Must delete ALL data associated with the shop.
 */
router.post("/shop/redact", async (req: Request, res: Response) => {
  const logger = getLogger();
  const prisma = getPrisma();

  if (!verifyWebhook(req)) {
    res.status(401).send("Unauthorized");
    return;
  }

  const shopDomain = (req.body as { shop_domain?: string }).shop_domain;
  if (!shopDomain) {
    res.status(400).json({ error: "Missing shop_domain" });
    return;
  }

  logger.info("Shop redact request received", { shopDomain });

  try {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });

    if (shop) {
      await deleteShopData(shop.id, shopDomain);
    }

    res.status(200).json({ message: "Shop data deleted." });
  } catch (err) {
    logger.error("Shop redact failed", {
      shopDomain,
      error: (err as Error).message,
    });
    res.status(500).json({ error: "Redact failed" });
  }
});

/**
 * Delete all data for a shop — used by both uninstall and shop/redact.
 */
export async function deleteShopData(
  shopId: string,
  shopDomain: string,
): Promise<void> {
  const prisma = getPrisma();
  const storage = getStorage();
  const logger = getLogger();

  logger.info("Deleting all shop data", { shopId, shopDomain });

  // Delete in dependency order (most dependent first)

  // 1. Import items
  const operations = await prisma.importOperation.findMany({
    where: { shopId },
    select: { id: true },
  });
  for (const op of operations) {
    await prisma.importItem.deleteMany({
      where: { importOperationId: op.id },
    });
  }

  // 2. Import operations
  await prisma.importOperation.deleteMany({ where: { shopId } });

  // 3. Catalog products & field mappings
  const catalogs = await prisma.catalog.findMany({
    where: { shopId },
    select: { id: true },
  });
  for (const cat of catalogs) {
    await prisma.catalogProduct.deleteMany({ where: { catalogId: cat.id } });
    await prisma.fieldMapping.deleteMany({ where: { catalogId: cat.id } });
  }

  // 4. Catalogs
  await prisma.catalog.deleteMany({ where: { shopId } });

  // 5. Uploaded files
  const uploads = await prisma.catalogUpload.findMany({
    where: { shopId },
    select: { storageKey: true },
  });
  for (const upload of uploads) {
    try {
      await storage.delete(upload.storageKey);
    } catch (err) {
      logger.warn("Failed to delete stored file", {
        storageKey: upload.storageKey,
        error: (err as Error).message,
      });
    }
  }

  // 6. Upload records
  await prisma.catalogUpload.deleteMany({ where: { shopId } });

  // 7. Shop record
  await prisma.shop.deleteMany({ where: { id: shopId } });

  logger.info("Shop data deletion complete", { shopId, shopDomain });
}

export { router as complianceRouter };
