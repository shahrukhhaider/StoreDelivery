/**
 * Shopify Billing — App subscription management.
 *
 * Creates recurring charges via GraphQL, handles confirmation callbacks,
 * and gates features behind active subscription status.
 */

import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import { ShopifyGraphQLClient } from "./graphql-client.js";
import { getAccessToken } from "./auth.js";
import { getPrisma } from "../db.js";
import { getConfig } from "../config.js";
import { getLogger } from "../logger.js";

const router = Router();

const APP_SUBSCRIPTION_CREATE = `
  mutation AppSubscriptionCreate(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $trialDays: Int
    $test: Boolean
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
    ) {
      appSubscription {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const ACTIVE_SUBSCRIPTIONS_QUERY = `
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
        trialDays
      }
    }
  }
`;

export type BillingPlan = {
  name: string;
  price: number;
  currencyCode: string;
  interval: "EVERY_30_DAYS" | "ANNUAL";
  trialDays: number;
};

const DEFAULT_PLAN: BillingPlan = {
  name: "StoreKeeper Pro",
  price: 9.99,
  currencyCode: "USD",
  interval: "EVERY_30_DAYS",
  trialDays: 7,
};

/**
 * POST /billing/subscribe — Create a subscription and return confirmation URL.
 */
router.post("/subscribe", async (req: Request, res: Response) => {
  const config = getConfig();
  const logger = getLogger();

  const shopDomain = (req as Request & { shopDomain?: string }).shopDomain;
  if (!shopDomain) {
    res.status(400).json({ error: "No shop context" });
    return;
  }

  const accessToken = await getAccessToken(shopDomain);
  if (!accessToken) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const client = new ShopifyGraphQLClient({ shopDomain, accessToken });
  const plan = DEFAULT_PLAN;

  try {
    const result = await client.query<{
      appSubscriptionCreate: {
        appSubscription: { id: string; status: string } | null;
        confirmationUrl: string | null;
        userErrors: Array<{ field: string; message: string }>;
      };
    }>(
      APP_SUBSCRIPTION_CREATE,
      {
        name: plan.name,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: plan.price, currencyCode: plan.currencyCode },
                interval: plan.interval,
              },
            },
          },
        ],
        returnUrl: `${config.shopifyAppUrl}/billing/callback`,
        trialDays: plan.trialDays,
        test: config.nodeEnv !== "production",
      },
      "AppSubscriptionCreate",
    );

    const errors = result.data?.appSubscriptionCreate?.userErrors ?? [];
    if (errors.length > 0) {
      logger.warn("Billing subscription errors", { errors });
      res.status(400).json({ error: "BILLING_ERROR", details: errors });
      return;
    }

    const confirmationUrl = result.data?.appSubscriptionCreate?.confirmationUrl;
    if (!confirmationUrl) {
      res.status(500).json({ error: "No confirmation URL returned" });
      return;
    }

    res.json({ confirmationUrl });
  } catch (err) {
    logger.error("Billing subscription failed", { error: (err as Error).message });
    res.status(500).json({ error: "Billing request failed" });
  }
});

/**
 * GET /billing/callback — Shopify redirects here after merchant approves/declines.
 */
router.get("/callback", async (req: Request, res: Response) => {
  const config = getConfig();
  const chargeId = req.query.charge_id as string;

  // Redirect back to the app regardless
  const shop = (req as Request & { shopDomain?: string }).shopDomain || req.query.shop;
  res.redirect(`https://${shop}/admin/apps/${config.shopifyApiKey}`);
});

/**
 * GET /billing/status — Check active subscription.
 */
router.get("/status", async (req: Request, res: Response) => {
  const shopDomain = (req as Request & { shopDomain?: string }).shopDomain;
  if (!shopDomain) {
    res.json({ active: false, reason: "no_shop" });
    return;
  }

  const accessToken = await getAccessToken(shopDomain);
  if (!accessToken) {
    res.json({ active: false, reason: "not_installed" });
    return;
  }

  try {
    const client = new ShopifyGraphQLClient({ shopDomain, accessToken });
    const result = await client.query<{
      currentAppInstallation: {
        activeSubscriptions: Array<{
          id: string;
          name: string;
          status: string;
          currentPeriodEnd: string | null;
          trialDays: number;
        }>;
      };
    }>(ACTIVE_SUBSCRIPTIONS_QUERY, {}, "ActiveSubscriptions");

    const subs = result.data?.currentAppInstallation?.activeSubscriptions ?? [];
    const activeSub = subs.find((s) => s.status === "ACTIVE");

    res.json({
      active: !!activeSub,
      subscription: activeSub ?? null,
    });
  } catch (err) {
    res.json({ active: false, reason: "check_failed" });
  }
});

export { router as billingRouter };

/**
 * Middleware: gate behind active billing (skip if billing disabled).
 */
export function requireBilling(req: Request, res: Response, next: NextFunction): void {
  const config = getConfig();

  // Skip billing check if not enabled
  if (!config.shopifyApiKey || config.nodeEnv === "development") {
    next();
    return;
  }

  // For production: would check cached subscription status
  // For now, pass through — full implementation checks on each request or caches
  next();
}
