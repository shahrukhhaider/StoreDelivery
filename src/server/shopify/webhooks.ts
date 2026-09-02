/**
 * Shopify Webhook Registration
 *
 * Registers required webhooks after app installation.
 * Shopify requires compliance webhooks for App Store approval.
 */

import { ShopifyGraphQLClient } from "./graphql-client.js";
import { getConfig } from "../config.js";
import { getLogger } from "../logger.js";

const WEBHOOK_SUBSCRIPTION_CREATE = `
  mutation WebhookSubscriptionCreate(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: $webhookSubscription
    ) {
      webhookSubscription {
        id
        topic
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const EXISTING_WEBHOOKS_QUERY = `
  query ExistingWebhooks {
    webhookSubscriptions(first: 25) {
      edges {
        node {
          id
          topic
          endpoint {
            __typename
            ... on WebhookHttpEndpoint {
              callbackUrl
            }
          }
        }
      }
    }
  }
`;

type WebhookTopic = {
  topic: string;
  path: string;
};

const REQUIRED_WEBHOOKS: WebhookTopic[] = [
  { topic: "APP_UNINSTALLED", path: "/webhooks/uninstall" },
  { topic: "CUSTOMERS_DATA_REQUEST", path: "/webhooks/customers/data_request" },
  { topic: "CUSTOMERS_REDACT", path: "/webhooks/customers/redact" },
  { topic: "SHOP_REDACT", path: "/webhooks/shop/redact" },
];

/**
 * Register all required webhooks for a shop.
 * Idempotent — checks existing subscriptions first and skips already-registered topics.
 */
export async function registerWebhooks(
  shopDomain: string,
  accessToken: string,
): Promise<void> {
  const config = getConfig();
  const logger = getLogger();
  const client = new ShopifyGraphQLClient({ shopDomain, accessToken });

  // Fetch existing webhook subscriptions
  const existingRes = await client.query<{
    webhookSubscriptions: {
      edges: Array<{
        node: {
          id: string;
          topic: string;
          endpoint: { callbackUrl?: string };
        };
      }>;
    };
  }>(EXISTING_WEBHOOKS_QUERY, {}, "ExistingWebhooks");

  const existingTopics = new Set(
    existingRes.data?.webhookSubscriptions?.edges?.map((e) => e.node.topic) ?? [],
  );

  const baseUrl = config.shopifyAppUrl;

  for (const webhook of REQUIRED_WEBHOOKS) {
    if (existingTopics.has(webhook.topic)) {
      logger.debug("Webhook already registered, skipping", {
        topic: webhook.topic,
        shopDomain,
      });
      continue;
    }

    const callbackUrl = `${baseUrl}${webhook.path}`;

    const res = await client.query<{
      webhookSubscriptionCreate: {
        webhookSubscription: { id: string; topic: string } | null;
        userErrors: Array<{ field: string; message: string }>;
      };
    }>(
      WEBHOOK_SUBSCRIPTION_CREATE,
      {
        topic: webhook.topic,
        webhookSubscription: {
          callbackUrl,
          format: "JSON",
        },
      },
      "WebhookSubscriptionCreate",
    );

    const errors = res.data?.webhookSubscriptionCreate?.userErrors ?? [];
    if (errors.length > 0) {
      logger.warn("Failed to register webhook", {
        topic: webhook.topic,
        errors,
        shopDomain,
      });
    } else {
      logger.info("Webhook registered", {
        topic: webhook.topic,
        callbackUrl,
        shopDomain,
      });
    }
  }
}
