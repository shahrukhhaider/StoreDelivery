/**
 * Vendor Scope Fetcher — retrieves all Shopify product IDs that belong to a
 * given vendor, identified by the app-owned metafield:
 *
 *   namespace: $app:store_delivery
 *   key:       vendor_id
 *   value:     <vendorProfileId>
 *
 * Used during Catalog Update reconciliation to compute MISSING products
 * (products in Shopify's vendor scope that are absent from the incoming file).
 */

import { ShopifyGraphQLClient } from "./graphql-client.js";
import { getLogger } from "../logger.js";

// ---------------------------------------------------------------------------
// GraphQL query
// ---------------------------------------------------------------------------

const VENDOR_PRODUCTS_QUERY = `
  query VendorProducts($query: String!, $cursor: String) {
    products(first: 250, after: $cursor, query: $query) {
      edges {
        node {
          id
          title
          handle
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

type ShopifyProductEdge = {
  node: {
    id: string;
    title: string;
    handle: string;
  };
};

type VendorProductsResponse = {
  products: {
    edges: ShopifyProductEdge[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

/**
 * Fetch all Shopify products owned by a vendor (by metafield).
 *
 * Returns a Map of shopifyProductId → { title, handle } for all products
 * that carry the vendor's app-owned metafield.
 *
 * Paginates automatically — no limit on catalog size.
 * Returns an empty Map if vendorProfileId is null (no vendor assigned).
 */
export async function fetchVendorScopedProducts(
  client: ShopifyGraphQLClient,
  vendorProfileId: string | null,
): Promise<Map<string, { title: string; handle: string }>> {
  const result = new Map<string, { title: string; handle: string }>();

  if (!vendorProfileId) return result;

  const logger = getLogger();

  // Shopify product search query using app-owned metafield
  // Format: metafield:<namespace>.<key>:<value>
  const searchQuery = `metafield:$app:store_delivery.vendor_id:${vendorProfileId}`;

  let cursor: string | null = null;
  let page = 0;

  do {
    try {
      const res: import("./graphql-client.js").GraphQLResponse<VendorProductsResponse> =
        await client.query<VendorProductsResponse>(
          VENDOR_PRODUCTS_QUERY,
          { query: searchQuery, cursor: cursor ?? undefined },
          "VendorProducts",
        );

      if (res.errors?.length) {
        logger.error("Vendor scope query errors", { errors: res.errors, vendorProfileId });
        break;
      }

      const edges: ShopifyProductEdge[] = res.data?.products?.edges ?? [];
      for (const edge of edges) {
        result.set(edge.node.id, {
          title: edge.node.title,
          handle: edge.node.handle,
        });
      }

      const rawPageInfo = res.data?.products?.pageInfo;
      const pageInfo: { hasNextPage: boolean; endCursor: string | null } = {
        hasNextPage: rawPageInfo?.hasNextPage ?? false,
        endCursor: rawPageInfo?.endCursor ?? null,
      };
      cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
      page++;

      logger.debug("Vendor scope page fetched", {
        vendorProfileId,
        page,
        count: edges.length,
        hasNextPage: pageInfo.hasNextPage,
      });
    } catch (err) {
      logger.error("Failed to fetch vendor scope page", {
        vendorProfileId,
        page,
        error: (err as Error).message,
      });
      break;
    }
  } while (cursor !== null);

  logger.info("Vendor scope fetched", {
    vendorProfileId,
    totalProducts: result.size,
    pages: page,
  });

  return result;
}
