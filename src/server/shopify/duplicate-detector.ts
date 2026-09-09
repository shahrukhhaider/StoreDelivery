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
  skus: Map<string, Array<{ productId: string; variantId: string }>>;
  barcodes: Map<string, Array<{ productId: string; variantId: string }>>;
  titles: Map<string, string>;
}> {
  const logger = getLogger();
  const skus = new Map<string, Array<{ productId: string; variantId: string }>>();
  const barcodes = new Map<string, Array<{ productId: string; variantId: string }>>();
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
          const key = variant.sku.toLowerCase().trim();
          const existing = skus.get(key) ?? [];
          existing.push({ productId, variantId });
          skus.set(key, existing);
        }
        if (variant.barcode) {
          const key = variant.barcode.toLowerCase().trim();
          const existing = barcodes.get(key) ?? [];
          existing.push({ productId, variantId });
          barcodes.set(key, existing);
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

// ---------------------------------------------------------------------------
// Targeted identity index — only fetches products matching supplier identifiers
// ---------------------------------------------------------------------------

const TARGETED_VARIANTS_QUERY = `
  query TargetedVariants($query: String!, $cursor: String) {
    productVariants(first: 100, after: $cursor, query: $query) {
      edges {
        node {
          id
          sku
          barcode
          product {
            id
            title
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

type VariantEdgeNode = {
  id: string;
  sku: string | null;
  barcode: string | null;
  product: { id: string; title: string };
};

type TargetedVariantsResult = {
  productVariants: {
    edges: Array<{ node: VariantEdgeNode }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

/**
 * Build a ShopifyIdentityIndex by querying ONLY the variants that match
 * the supplier catalog's SKUs and barcodes. Much faster than full pagination
 * for large stores — only fetches what we need to match.
 *
 * Falls back to full fetchShopifyIdentityIndex if the targeted query fails.
 */
export async function fetchTargetedIdentityIndex(
  client: ShopifyGraphQLClient,
  supplierSkus: string[],
  supplierBarcodes: string[],
): Promise<{
  skus: Map<string, Array<{ productId: string; variantId: string }>>;
  barcodes: Map<string, Array<{ productId: string; variantId: string }>>;
  titles: Map<string, string>;
}> {
  const logger = getLogger();
  const skus = new Map<string, Array<{ productId: string; variantId: string }>>();
  const barcodes = new Map<string, Array<{ productId: string; variantId: string }>>();
  const titles = new Map<string, string>();

  if (supplierSkus.length === 0 && supplierBarcodes.length === 0) {
    logger.info("No SKUs or barcodes in supplier catalog — skipping targeted fetch");
    return { skus, barcodes, titles };
  }

  // Batch all identifiers into chunks of 100 terms per query.
  // The GraphQL client handles Shopify's cost-based throttling automatically —
  // it proactively pauses when the cost bucket runs low and retries on 429s.
  const TERMS_PER_BATCH = 100;
  const skuTerms = supplierSkus.map((s) => `sku:"${s.replace(/"/g, '\\"')}"`);
  const barcodeTerms = supplierBarcodes.map((b) => `barcode:"${b.replace(/"/g, '\\"')}"`);
  const allTerms = [...skuTerms, ...barcodeTerms];

  if (allTerms.length === 0) {
    return { skus, barcodes, titles };
  }

  // Split into batches of TERMS_PER_BATCH
  const batches: string[][] = [];
  for (let i = 0; i < allTerms.length; i += TERMS_PER_BATCH) {
    batches.push(allTerms.slice(i, i + TERMS_PER_BATCH));
  }

  logger.info("Fetching targeted Shopify variants", {
    totalTerms: allTerms.length,
    batches: batches.length,
    skuCount: supplierSkus.length,
    barcodeCount: supplierBarcodes.length,
  });

  for (const batch of batches) {
    const queryString = batch.join(" OR ");
    let cursor: string | null = null;
    let pageCount = 0;

    try {
      while (true) {
        const res: GraphQLResponse<TargetedVariantsResult> = await client.query<TargetedVariantsResult>(
          TARGETED_VARIANTS_QUERY,
          { query: queryString, cursor },
          "TargetedVariants",
        );

        if (res.errors?.length) {
          logger.warn("Targeted variant query error — falling back to full fetch", { errors: res.errors });
          return fetchShopifyIdentityIndex(client);
        }

        const result = res.data?.productVariants;
        if (!result) break;

        for (const edge of result.edges) {
          const v = edge.node;
          const productId = v.product.id;
          const variantId = v.id;

          titles.set(v.product.title.toLowerCase().trim(), productId);

          if (v.sku) {
            const key = v.sku.toLowerCase().trim();
            const existing = skus.get(key) ?? [];
            existing.push({ productId, variantId });
            skus.set(key, existing);
          }
          if (v.barcode) {
            const key = v.barcode.toLowerCase().trim();
            const existing = barcodes.get(key) ?? [];
            existing.push({ productId, variantId });
            barcodes.set(key, existing);
          }
        }

        pageCount++;
        if (!result.pageInfo.hasNextPage) break;
        cursor = result.pageInfo.endCursor;
      }
    } catch (err) {
      logger.warn("Targeted variant fetch failed — falling back to full fetch", {
        error: (err as Error).message,
      });
      return fetchShopifyIdentityIndex(client);
    }
  }

  logger.info("Targeted identity index built", {
    supplierSkus: supplierSkus.length,
    supplierBarcodes: supplierBarcodes.length,
    batches: batches.length,
    matchedSkus: skus.size,
    matchedBarcodes: barcodes.size,
  });

  return { skus, barcodes, titles };
}
