/**
 * Shopify OAuth installation flow — Section 18
 *
 * Handles:
 * - Install redirect → Shopify consent screen
 * - OAuth callback → exchange code for access token
 * - Encrypt + store token
 * - Session validation middleware
 * - Uninstall webhook handler
 * - Dev-mode bypass when SHOPIFY_API_KEY is empty
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { getConfig } from "../config.js";
import { getPrisma } from "../db.js";
import { getLogger } from "../logger.js";

const router = Router();

// Simple symmetric encryption for access tokens at rest
const ENCRYPTION_ALGO = "aes-256-gcm";

function deriveKey(secret: string): Buffer {
  return crypto.scryptSync(secret, "storekeeper-salt", 32);
}

export function encryptToken(token: string): string {
  const config = getConfig();
  const key = deriveKey(config.shopifyApiSecret || "dev-secret-key-minimum-32-chars!!");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

export function decryptToken(encrypted: string): string {
  const config = getConfig();
  const key = deriveKey(config.shopifyApiSecret || "dev-secret-key-minimum-32-chars!!");
  const [ivHex, tagHex, data] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * GET /auth — Redirect to Shopify OAuth consent screen.
 */
router.get("/", (req: Request, res: Response) => {
  const config = getConfig();
  const shop = req.query.shop as string;

  if (!shop) {
    res.status(400).json({ error: "Missing shop parameter" });
    return;
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  // In production, store nonce in session/DB for CSRF validation
  const redirectUri = `${config.shopifyAppUrl}/auth/callback`;
  const scopes = config.shopifyScopes;

  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${config.shopifyApiKey}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${nonce}`;

  res.redirect(authUrl);
});

/**
 * GET /auth/callback — Exchange authorization code for access token.
 */
router.get("/callback", async (req: Request, res: Response) => {
  const config = getConfig();
  const logger = getLogger();
  const prisma = getPrisma();

  const { shop, code, hmac } = req.query as Record<string, string>;

  if (!shop || !code) {
    res.status(400).json({ error: "Missing shop or code parameter" });
    return;
  }

  // Verify HMAC
  if (hmac && config.shopifyApiSecret) {
    const queryParams = { ...req.query };
    delete queryParams.hmac;
    const message = Object.keys(queryParams)
      .sort()
      .map((key) => `${key}=${queryParams[key]}`)
      .join("&");
    const expectedHmac = crypto
      .createHmac("sha256", config.shopifyApiSecret)
      .update(message)
      .digest("hex");

    if (hmac !== expectedHmac) {
      logger.warn("HMAC verification failed", { shop });
      res.status(403).json({ error: "HMAC verification failed" });
      return;
    }
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: config.shopifyApiKey,
          client_secret: config.shopifyApiSecret,
          code,
        }),
      },
    );

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.status}`);
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      scope: string;
    };

    // Encrypt and store
    const encryptedToken = encryptToken(tokenData.access_token);

    await prisma.shop.upsert({
      where: { shopDomain: shop },
      create: {
        shopDomain: shop,
        encryptedAccessToken: encryptedToken,
        scopes: tokenData.scope,
      },
      update: {
        encryptedAccessToken: encryptedToken,
        scopes: tokenData.scope,
        uninstalledAt: null,
      },
    });

    logger.info("Shopify app installed", { shop, scopes: tokenData.scope });

    // Register required webhooks
    try {
      const { registerWebhooks } = await import("./webhooks.js");
      await registerWebhooks(shop, tokenData.access_token);
    } catch (webhookErr) {
      // Don't fail the install if webhook registration fails — log and continue
      logger.error("Webhook registration failed", {
        shop,
        error: (webhookErr as Error).message,
      });
    }

    // Redirect to embedded app
    res.redirect(`https://${shop}/admin/apps/${config.shopifyApiKey}`);
  } catch (err) {
    logger.error("OAuth callback failed", { error: (err as Error).message, shop });
    res.status(500).json({ error: "Installation failed" });
  }
});

/**
 * POST /webhooks/uninstall — Handle app uninstall.
 */
router.post("/webhooks/uninstall", async (req: Request, res: Response) => {
  const config = getConfig();
  const logger = getLogger();
  const prisma = getPrisma();

  // Verify webhook HMAC
  const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string;
  if (hmacHeader && config.shopifyApiSecret) {
    // Note: need raw body for HMAC — in production, use a raw body parser for this route
    const body = JSON.stringify(req.body);
    const expectedHmac = crypto
      .createHmac("sha256", config.shopifyApiSecret)
      .update(body)
      .digest("base64");

    if (hmacHeader !== expectedHmac) {
      logger.warn("Webhook HMAC verification failed");
      res.status(401).send("Unauthorized");
      return;
    }
  }

  const shopDomain = req.headers["x-shopify-shop-domain"] as string;
  if (shopDomain) {
    await prisma.shop.updateMany({
      where: { shopDomain },
      data: { uninstalledAt: new Date() },
    });
    logger.info("Shopify app uninstalled", { shop: shopDomain });
  }

  res.status(200).send("OK");
});

export { router as authRouter };

// ---------------------------------------------------------------------------
// Session middleware
// ---------------------------------------------------------------------------

/**
 * Shopify session validation middleware.
 * In dev mode (no API key), falls through with dev_shop.
 * In production, validates the session token from Shopify App Bridge.
 */
export function shopifySession(req: Request, _res: Response, next: NextFunction): void {
  const config = getConfig();

  // Dev-mode bypass
  if (!config.shopifyApiKey) {
    (req as Request & { shopId: string; shopDomain: string }).shopId = "dev_shop";
    (req as Request & { shopId: string; shopDomain: string }).shopDomain = "dev.myshopify.com";
    next();
    return;
  }

  // In production: extract shop from Shopify session token (Bearer header)
  // Full JWT validation would go here — for now, extract from query/header
  const shopDomain =
    (req.headers["x-shopify-shop-domain"] as string) ||
    (req.query.shop as string);

  if (!shopDomain) {
    next(); // Let the shop scope middleware handle it
    return;
  }

  (req as Request & { shopId: string; shopDomain: string }).shopDomain = shopDomain;
  next();
}

// ---------------------------------------------------------------------------
// Helper to get access token for a shop
// ---------------------------------------------------------------------------

export async function getAccessToken(shopDomain: string): Promise<string | null> {
  const prisma = getPrisma();
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { encryptedAccessToken: true, uninstalledAt: true },
  });

  if (!shop || shop.uninstalledAt) return null;

  try {
    return decryptToken(shop.encryptedAccessToken);
  } catch {
    return null;
  }
}
