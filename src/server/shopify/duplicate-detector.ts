/**
 * Duplicate Detection — Section 11
 *
 * Before writes, reads existing Shopify identifiers and checks for matches.
 * V0: show duplicates, default = skip, never update existing.
 */

import { ShopifyGraphQLClient, type GraphQLResponse } from "./graphql-client.js";
import { getLogger } from "../logger.js";
import type { CatalogProduct } from "@shared/types/catalog.js";

export type DuplicateMatch = {
  sourceKey: string;
  matchType: "sku" | "barcode" | "title";
  matchValue: string;
  existingShopifyProductId: string;
};

type ShopifyProductEdge = {
  node: {
    id: string;
    title: string;
    variants: {
      edges: Array<{
        node: {
          id: string;
          sku: string | null;
          barcode: string | null;
        };
      }>;
    };
  };
};

const PRODUCTS_QUERY = `
  query ExistingProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      edges {
        node {
          id
          title
          variants(first: 100) {
            edges {
              node {
                id
                sku
                barcode
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Fetch all existing SKUs and barcodes from the Shopify store.
 */
export async function fetchExistingIdentifiers(
  client: ShopifyGraphQLClient,
): Promise<{
  skus: Map<string, string>; // sku → shopify product ID
  barcodes: Map<string, string>; // barcode → shopify product ID
  titles: Map<string, string>; // lowercase title → shopify product ID
}> {
  const logger = getLogger();
  const skus = new Map<string, string>();
  const barcodes = new Map<string, string>();
  const titles = new Map<string, string>();

  let cursor: string | null = null;
  let pageCount = 0;

  type ProductsQueryResult = {
    products: {
      edges: ShopifyProductEdge[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };

  while (true) {
    const res: GraphQLResponse<ProductsQueryResult> = await client.query<ProductsQueryResult>(
      PRODUCTS_QUERY, { cursor }, "ExistingProducts",
    );

    if (res.errors?.length) {
      logger.error("Failed to fetch existing products", { errors: res.errors });
      break;
    }

    const products: ProductsQueryResult["products"] | undefined = res.data?.products;
    if (!products) break;

    for (const edge of products.edges) {
      const product = edge.node;
      const productId = product.id;

      titles.set(product.title.toLowerCase().trim(), productId);

      for (const variantEdge of product.variants.edges) {
        const variant = variantEdge.node;
        if (variant.sku) {
          skus.set(variant.sku.toLowerCase().trim(), productId);
        }
        if (variant.barcode) {
          barcodes.set(variant.barcode.toLowerCase().trim(), productId);
        }
      }
    }

    pageCount++;
    logger.debug("Fetched existing products page", {
      page: pageCount,
      productCount: products.edges.length,
    });

    if (!products.pageInfo.hasNextPage) break;
    cursor = products.pageInfo.endCursor;
  }

  logger.info("Existing identifiers fetched", {
    skus: skus.size,
    barcodes: barcodes.size,
    titles: titles.size,
    pages: pageCount,
  });

  return { skus, barcodes, titles };
}

/**
 * Detect duplicates between catalog products and existing Shopify store.
 */
export function detectDuplicates(
  products: CatalogProduct[],
  existing: {
    skus: Map<string, string>;
    barcodes: Map<string, string>;
    titles: Map<string, string>;
  },
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];

  for (const product of products) {
    // Check variants for SKU/barcode matches
    for (const variant of product.variants) {
      if (variant.sku) {
        const existingId = existing.skus.get(variant.sku.toLowerCase().trim());
        if (existingId) {
          matches.push({
            sourceKey: product.sourceKey,
            matchType: "sku",
            matchValue: variant.sku,
            existingShopifyProductId: existingId,
          });
          break; // One match per product is enough
        }
      }

      if (variant.barcode) {
        const existingId = existing.barcodes.get(variant.barcode.toLowerCase().trim());
        if (existingId) {
          matches.push({
            sourceKey: product.sourceKey,
            matchType: "barcode",
            matchValue: variant.barcode,
            existingShopifyProductId: existingId,
          });
          break;
        }
      }
    }
  }

  return matches;
}

/**
 * Build a ShopifyIdentityIndex with variant-level IDs for reconciliation.
 * Enhanced version of fetchExistingIdentifiers that preserves variant GIDs.
 */
export async function fetchShopifyIdentityIndex(
  client: ShopifyGraphQLClient,
): Promise<{
  skus: Map<string, { productId: string; variantId: string }>;
  barcodes: Map<string, { productId: string; variantId: string }>;
  titles: Map<string, string>;
}> {
  const logger = getLogger();
  const skus = new Map<string, { productId: string; variantId: string }>();
  const barcodes = new Map<string, { productId: string; variantId: string }>();
  const titles = new Map<string, string>();

  let cursor: string | null = null;
  let pageCount = 0;

  type ProductsQueryResult = {
    products: {
      edges: ShopifyProductEdge[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };

  while (true) {
    const res: GraphQLResponse<ProductsQueryResult> = await client.query<ProductsQueryResult>(
      PRODUCTS_QUERY, { cursor }, "ExistingProducts",
    );

    if (res.errors?.length) {
      logger.error("Failed to fetch existing products for reconciliation", { errors: res.errors });
      break;
    }

    const products: ProductsQueryResult["products"] | undefined = res.data?.products;
    if (!products) break;

    for (const edge of products.edges) {
      const product = edge.node;
      const productId = product.id;

      titles.set(product.title.toLowerCase().trim(), productId);

      for (const variantEdge of product.variants.edges) {
        const variant = variantEdge.node;
        const variantId = variant.id;
        if (variant.sku) {
          skus.set(variant.sku.toLowerCase().trim(), { productId, variantId });
        }
        if (variant.barcode) {
          barcodes.set(variant.barcode.toLowerCase().trim(), { productId, variantId });
        }
      }
    }

    pageCount++;
    if (!products.pageInfo.hasNextPage) break;
    cursor = products.pageInfo.endCursor;
  }

  logger.info("Shopify identity index built", {
    skus: skus.size,
    barcodes: barcodes.size,
    titles: titles.size,
    pages: pageCount,
  });

  return { skus, barcodes, titles };
}
