/**
 * Shopify Writer — Section 14
 *
 * Creates products via Shopify Admin GraphQL API with bounded concurrency,
 * rate-limit handling, retry, and per-item tracking.
 */

import { ShopifyGraphQLClient, type GraphQLResponse } from "./graphql-client.js";
import { getLogger } from "../logger.js";
import type { CatalogProduct } from "@shared/types/catalog.js";

// ---------------------------------------------------------------------------
// Location query
// ---------------------------------------------------------------------------

const PRIMARY_LOCATION_QUERY = `
  query PrimaryLocation {
    locations(first: 1) {
      edges {
        node {
          id
          name
          isActive
        }
      }
    }
  }
`;

/**
 * Fetch the shop's primary (first) location ID.
 * Cached per client instance for the duration of an import.
 */
const locationCache = new Map<string, string>();

export async function getPrimaryLocationId(
  client: ShopifyGraphQLClient,
  shopDomain: string,
): Promise<string | null> {
  const cached = locationCache.get(shopDomain);
  if (cached) return cached;

  try {
    const res = await client.query<{
      locations: {
        edges: Array<{ node: { id: string; name: string; isActive: boolean } }>;
      };
    }>(PRIMARY_LOCATION_QUERY, {}, "PrimaryLocation");

    const locationId = res.data?.locations?.edges?.[0]?.node?.id;
    if (!locationId) {
      return null; // No location — inventory quantities will be skipped
    }

    locationCache.set(shopDomain, locationId);
    return locationId;
  } catch {
    return null; // Location query failed — skip inventory
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WriteResult = {
  sourceKey: string;
  success: boolean;
  shopifyProductId?: string;
  errorCode?: string;
  errorMessage?: string;
  imagesAttached: number;
  imagesFailed: number;
};

export type WriterOptions = {
  /** Max concurrent Shopify mutations (default: 4) */
  concurrency?: number;
  /** Shop's primary location ID — null means skip inventory quantities */
  locationId: string | null;
  /** Shop domain — used for location cache key */
  shopDomain: string;
  /** Callback after each product write (for progress tracking) */
  onItemComplete?: (result: WriteResult) => void | Promise<void>;
};

// ---------------------------------------------------------------------------
// GraphQL mutations — using productSet (2024-10+ API)
// ---------------------------------------------------------------------------

const PRODUCT_SET_MUTATION = `
  mutation ProductSet($synchronous: Boolean!, $productSet: ProductSetInput!) {
    productSet(synchronous: $synchronous, input: $productSet) {
      product {
        id
        title
        variants(first: 100) {
          edges {
            node {
              id
              sku
            }
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Product input builder — productSet format
// ---------------------------------------------------------------------------

function buildProductSetInput(product: CatalogProduct, locationId: string | null): {
  productSet: Record<string, unknown>;
} {
  // Build variants in productSet format
  const variants = product.variants.map((v) => {
    const variant: Record<string, unknown> = {};
    if (v.sku) variant.sku = v.sku;
    if (v.barcode) variant.barcode = v.barcode;
    if (v.price) {
      variant.price = v.price;
    }
    if (v.compareAtPrice) variant.compareAtPrice = v.compareAtPrice;

    // Options: optionValues must not be null — always provide at least one
    const optionEntries = Object.entries(v.options).filter(([, val]) => Boolean(val));
    if (optionEntries.length > 0) {
      variant.optionValues = optionEntries.map(([optionName, value]) => ({
        optionName,
        name: value,
      }));
    } else {
      // Default option so Shopify doesn't reject the variant
      variant.optionValues = [{ optionName: "Title", name: "Default Title" }];
    }

    return variant;
  });

  // Build product options from variant data
  const productOptions = buildProductOptions(product);
  // Ensure at least one option exists
  if (productOptions.length === 0) {
    productOptions.push({ name: "Title", values: [{ name: "Default Title" }] });
  }

  const productSet: Record<string, unknown> = {
    title: product.title || "Untitled Product",
    productOptions,
    variants,
  };

  if (product.description) productSet.descriptionHtml = product.description;
  if (product.vendor) productSet.vendor = product.vendor;
  if (product.productType) productSet.productType = product.productType;
  if (product.tags.length > 0) productSet.tags = product.tags;

  // Files (images) — productSet uses "files" not "media"
  const files = product.images
    .filter((img) => img.sourceUrl.startsWith("http"))
    .map((img) => ({
      originalSource: img.sourceUrl,
      alt: img.altText ?? "",
      contentType: "IMAGE",
    }));
  if (files.length > 0) {
    productSet.files = files;
  }

  return { productSet };
}

/**
 * Build productOptions array from variant option keys.
 * productSet requires options to be declared with their values.
 */
function buildProductOptions(product: CatalogProduct): Array<{ name: string; values: Array<{ name: string }> }> {
  const optionMap = new Map<string, Set<string>>();

  for (const variant of product.variants) {
    for (const [key, value] of Object.entries(variant.options)) {
      if (!value) continue;
      if (!optionMap.has(key)) optionMap.set(key, new Set());
      optionMap.get(key)!.add(value);
    }
  }

  if (optionMap.size === 0) return [];

  return Array.from(optionMap.entries()).map(([name, values]) => ({
    name,
    values: Array.from(values).map((v) => ({ name: v })),
  }));
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Write a batch of catalog products to Shopify.
 */
export async function writeProducts(
  client: ShopifyGraphQLClient,
  products: CatalogProduct[],
  options: WriterOptions,
): Promise<WriteResult[]> {
  const concurrency = options.concurrency ?? 4;
  const logger = getLogger();
  const results: WriteResult[] = [];

  // Process in bounded-concurrency batches
  const queue = [...products];
  const active: Promise<void>[] = [];

  async function processOne(product: CatalogProduct): Promise<void> {
    const result = await writeOneProduct(client, product, options.locationId ?? null, logger);
    results.push(result);
    if (options?.onItemComplete) {
      await options.onItemComplete(result);
    }
  }

  while (queue.length > 0 || active.length > 0) {
    // Fill up to concurrency limit
    while (queue.length > 0 && active.length < concurrency) {
      const product = queue.shift()!;
      const promise = processOne(product).then(() => {
        active.splice(active.indexOf(promise), 1);
      });
      active.push(promise);
    }

    // Wait for at least one to complete
    if (active.length > 0) {
      await Promise.race(active);
    }
  }

  return results;
}

async function writeOneProduct(
  client: ShopifyGraphQLClient,
  product: CatalogProduct,
  locationId: string | null,
  logger: ReturnType<typeof getLogger>,
): Promise<WriteResult> {
  try {
    const { productSet } = buildProductSetInput(product, locationId);
    const imageCount = product.images.filter((img) => img.sourceUrl.startsWith("http")).length;

    const res = await client.query<{
      productSet: {
        product: { id: string; title: string } | null;
        userErrors: Array<{ field: string[]; message: string; code: string }>;
      };
    }>(
      PRODUCT_SET_MUTATION,
      { synchronous: true, productSet },
      "ProductSet",
    );

    // Check for user errors (validation failures — not retryable)
    const userErrors = res.data?.productSet?.userErrors ?? [];
    if (userErrors.length > 0) {
      const errorMsg = userErrors.map((e) => e.message).join("; ");
      logger.warn("Product set validation error", {
        sourceKey: product.sourceKey,
        errors: userErrors,
      });
      return {
        sourceKey: product.sourceKey,
        success: false,
        errorCode: "VALIDATION_ERROR",
        errorMessage: errorMsg,
        imagesAttached: 0,
        imagesFailed: product.images.length,
      };
    }

    // Check for GraphQL-level errors
    if (res.errors?.length) {
      const errorMsg = res.errors.map((e) => e.message).join("; ");
      return {
        sourceKey: product.sourceKey,
        success: false,
        errorCode: "GRAPHQL_ERROR",
        errorMessage: errorMsg,
        imagesAttached: 0,
        imagesFailed: product.images.length,
      };
    }

    const createdProduct = res.data?.productSet?.product;
    if (!createdProduct) {
      return {
        sourceKey: product.sourceKey,
        success: false,
        errorCode: "NO_PRODUCT_RETURNED",
        errorMessage: "productSet returned no product",
        imagesAttached: 0,
        imagesFailed: product.images.length,
      };
    }

    logger.info("Product created in Shopify", {
      sourceKey: product.sourceKey,
      shopifyProductId: createdProduct.id,
    });

    return {
      sourceKey: product.sourceKey,
      success: true,
      shopifyProductId: createdProduct.id,
      imagesAttached: imageCount,
      imagesFailed: product.images.length - imageCount,
    };
  } catch (err) {
    logger.error("Product write failed", {
      sourceKey: product.sourceKey,
      error: (err as Error).message,
    });
    return {
      sourceKey: product.sourceKey,
      success: false,
      errorCode: "WRITE_ERROR",
      errorMessage: (err as Error).message,
      imagesAttached: 0,
      imagesFailed: product.images.length,
    };
  }
}
