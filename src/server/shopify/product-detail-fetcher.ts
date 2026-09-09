/**
 * Shopify Product Detail Fetcher — fetches full product data by ID for diff computation.
 *
 * Queries live Shopify API for product + variant fields needed by the diff engine:
 * title, description, vendor, productType, tags, images, and per-variant
 * price, compareAtPrice, barcode, inventoryQuantity, weight.
 *
 * Uses node queries with batched IDs to minimize API calls.
 */

import { ShopifyGraphQLClient, type GraphQLResponse } from "./graphql-client.js";
import { getLogger } from "../logger.js";
import type { SnapshotProduct, SnapshotVariant } from "@shared/types/reconciliation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShopifyProductDetail = {
  product: SnapshotProduct;
  variants: SnapshotVariant[];
};

// ---------------------------------------------------------------------------
// GraphQL query — fetches full product detail by IDs
// ---------------------------------------------------------------------------

const PRODUCT_DETAILS_QUERY = `
  query ProductDetails($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        descriptionHtml
        handle
        vendor
        productType
        status
        tags
        images(first: 20) {
          edges {
            node {
              url
              altText
            }
          }
        }
        variants(first: 100) {
          edges {
            node {
              id
              sku
              barcode
              price
              compareAtPrice
              inventoryQuantity
              weight
              selectedOptions {
                name
                value
              }
            }
          }
        }
      }
    }
  }
`;

type ShopifyProductNode = {
  id: string;
  title: string;
  descriptionHtml: string | null;
  handle: string;
  vendor: string | null;
  productType: string | null;
  status: string;
  tags: string[];
  images: {
    edges: Array<{ node: { url: string; altText: string | null } }>;
  };
  variants: {
    edges: Array<{
      node: {
        id: string;
        sku: string | null;
        barcode: string | null;
        price: string | null;
        compareAtPrice: string | null;
        inventoryQuantity: number | null;
        weight: number | null;
        selectedOptions: Array<{ name: string; value: string }>;
      };
    }>;
  };
};

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

/**
 * Fetch full product details from Shopify for a batch of product IDs.
 * Returns a map of shopifyProductId → ShopifyProductDetail.
 *
 * Uses the `nodes` query to batch up to 50 IDs per request.
 * Products that fail to fetch are silently omitted from the result.
 */
export async function fetchProductDetails(
  client: ShopifyGraphQLClient,
  shopifyProductIds: string[],
): Promise<Map<string, ShopifyProductDetail>> {
  const logger = getLogger();
  const result = new Map<string, ShopifyProductDetail>();

  if (shopifyProductIds.length === 0) return result;

  // Batch into groups of 50 (Shopify nodes query limit)
  const batches: string[][] = [];
  for (let i = 0; i < shopifyProductIds.length; i += 50) {
    batches.push(shopifyProductIds.slice(i, i + 50));
  }

  for (const batch of batches) {
    try {
      const res: GraphQLResponse<{ nodes: Array<ShopifyProductNode | null> }> =
        await client.query<{ nodes: Array<ShopifyProductNode | null> }>(
          PRODUCT_DETAILS_QUERY,
          { ids: batch },
          "ProductDetails",
        );

      if (res.errors?.length) {
        logger.error("Product detail fetch errors", { errors: res.errors });
      }

      const nodes = res.data?.nodes ?? [];
      for (const node of nodes) {
        if (!node || !node.id) continue;

        const options = node.variants.edges[0]?.node.selectedOptions ?? [];

        const product: SnapshotProduct = {
          shopifyProductId: node.id,
          title: node.title,
          description: node.descriptionHtml,
          handle: node.handle,
          vendor: node.vendor,
          productType: node.productType,
          status: node.status,
          tags: node.tags ?? [],
          images: node.images.edges.map((e) => ({
            url: e.node.url,
            altText: e.node.altText,
          })),
        };

        const variants: SnapshotVariant[] = node.variants.edges.map((e) => {
          const v = e.node;
          const opts = v.selectedOptions ?? [];
          return {
            shopifyVariantId: v.id,
            shopifyProductId: node.id,
            sku: v.sku,
            barcode: v.barcode,
            price: v.price,
            compareAtPrice: v.compareAtPrice,
            inventoryQuantity: v.inventoryQuantity,
            weight: v.weight,
            weightUnit: null,  // weightUnit not available directly on ProductVariant in Admin API 2024-10
            option1: opts[0]?.value ?? null,
            option2: opts[1]?.value ?? null,
            option3: opts[2]?.value ?? null,
          };
        });

        result.set(node.id, { product, variants });
      }
    } catch (err) {
      logger.error("Failed to fetch product details batch", {
        batchSize: batch.length,
        error: (err as Error).message,
      });
      // Continue with other batches — partial results are better than none
    }
  }

  logger.info("Product details fetched", {
    requested: shopifyProductIds.length,
    fetched: result.size,
  });

  return result;
}
