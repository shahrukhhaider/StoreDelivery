/**
 * Shopify Admin GraphQL Client — rate-limit aware with retry + backoff.
 *
 * Uses Shopify's cost-based throttling from `extensions.cost` responses
 * to avoid hitting rate limits proactively.
 */

import { getLogger } from "../logger.js";

export type GraphQLResponse<T = Record<string, unknown>> = {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
};

export type ShopifyClientOptions = {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
  maxRetries?: number;
  /** Minimum available cost points before we voluntarily throttle */
  throttleThreshold?: number;
};

const DEFAULT_API_VERSION = "2025-07";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_THROTTLE_THRESHOLD = 100;

export class ShopifyGraphQLClient {
  private shopDomain: string;
  private accessToken: string;
  private apiVersion: string;
  private maxRetries: number;
  private throttleThreshold: number;
  private endpoint: string;

  constructor(options: ShopifyClientOptions) {
    this.shopDomain = options.shopDomain;
    this.accessToken = options.accessToken;
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.throttleThreshold = options.throttleThreshold ?? DEFAULT_THROTTLE_THRESHOLD;
    this.endpoint = `https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
  }

  /**
   * Execute a GraphQL query/mutation with automatic retry and rate-limit handling.
   */
  async query<T = Record<string, unknown>>(
    operation: string,
    variables?: Record<string, unknown>,
    operationName?: string,
  ): Promise<GraphQLResponse<T>> {
    const logger = getLogger();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const start = Date.now();

        const res = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": this.accessToken,
          },
          body: JSON.stringify({
            query: operation,
            variables,
          }),
        });

        const duration = Date.now() - start;

        // Handle HTTP-level rate limit
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
          logger.warn("Shopify rate limit hit (429)", {
            shopDomain: this.shopDomain,
            retryAfter,
            attempt,
          });
          await sleep(retryAfter * 1000);
          continue;
        }

        // Handle server errors with retry
        if (res.status >= 500) {
          logger.warn("Shopify server error", {
            status: res.status,
            attempt,
            shopDomain: this.shopDomain,
          });
          if (attempt < this.maxRetries) {
            await sleep(exponentialBackoff(attempt));
            continue;
          }
          throw new Error(`Shopify server error: ${res.status}`);
        }

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Shopify API error ${res.status}: ${text}`);
        }

        const body: GraphQLResponse<T> = await res.json();

        // Log cost info
        const cost = body.extensions?.cost;
        if (cost) {
          logger.debug("Shopify GraphQL cost", {
            operationName,
            requestedCost: cost.requestedQueryCost,
            actualCost: cost.actualQueryCost,
            available: cost.throttleStatus.currentlyAvailable,
            duration,
          });

          // Proactive throttle: if available points are low, wait for restoration
          if (cost.throttleStatus.currentlyAvailable < this.throttleThreshold) {
            const deficit = this.throttleThreshold - cost.throttleStatus.currentlyAvailable;
            const waitMs = Math.ceil((deficit / cost.throttleStatus.restoreRate) * 1000);
            logger.info("Proactive throttle — waiting for cost restoration", {
              available: cost.throttleStatus.currentlyAvailable,
              waitMs,
            });
            await sleep(waitMs);
          }
        }

        // Check for throttled errors in the GraphQL response
        const throttleError = body.errors?.find(
          (e) => e.extensions?.code === "THROTTLED",
        );
        if (throttleError) {
          logger.warn("Shopify GraphQL throttled", {
            attempt,
            shopDomain: this.shopDomain,
          });
          if (attempt < this.maxRetries) {
            await sleep(exponentialBackoff(attempt));
            continue;
          }
        }

        return body;
      } catch (err) {
        lastError = err as Error;

        // Retry on network errors
        if (isTransient(err) && attempt < this.maxRetries) {
          logger.warn("Transient error, retrying", {
            error: (err as Error).message,
            attempt,
          });
          await sleep(exponentialBackoff(attempt));
          continue;
        }

        throw err;
      }
    }

    throw lastError ?? new Error("Max retries exceeded");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exponentialBackoff(attempt: number): number {
  // 1s, 2s, 4s, 8s... with jitter
  const base = Math.min(1000 * Math.pow(2, attempt), 30000);
  const jitter = Math.random() * 500;
  return base + jitter;
}

function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("timeout") ||
    msg.includes("socket")
  );
}
