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
): Promise<string> {
  const cached = locationCache.get(shopDomain);
  if (cached) return cached;

  const res = await client.query<{
    locations: {
      edges: Array<{ node: { id: string; name: string; isActive: boolean } }>;
    };
  }>(PRIMARY_LOCATION_QUERY, {}, "PrimaryLocation");

  const locationId = res.data?.locations?.edges?.[0]?.node?.id;
  if (!locationId) {
    throw new Error("No locations found for shop — cannot set inventory");
  }

  locationCache.set(shopDomain, locationId);
  return locationId;
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
  /** Shop's primary location ID — required for inventory quantities */
  locationId: string;
  /** Shop domain — used for location cache key */
  shopDomain: string;
  /** Callback after each product write (for progress tracking) */
  onItemComplete?: (result: WriteResult) => void | Promise<void>;
};

// ---------------------------------------------------------------------------
// GraphQL mutations
// ---------------------------------------------------------------------------

const PRODUCT_CREATE_MUTATION = `
  mutation ProductCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
    productCreate(input: $input, media: $media) {
      product {
        id
        title
        variants(first: 10) {
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
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Product input builder
// ---------------------------------------------------------------------------

function buildProductInput(product: CatalogProduct, locationId: string): {
  input: Record<string, unknown>;
  media: Array<Record<string, unknown>>;
} {
  const variants = product.variants.map((v) => {
    const variant: Record<string, unknown> = {};
    if (v.sku) variant.sku = v.sku;
    if (v.barcode) variant.barcode = v.barcode;
    if (v.price) variant.price = v.price;
    if (v.compareAtPrice) variant.compareAtPrice = v.compareAtPrice;
    if (v.inventoryQuantity !== undefined) {
      variant.inventoryQuantities = {
        availableQuantity: v.inventoryQuantity,
        locationId,
      };
    }
    if (v.weight !== undefined) {
      variant.weight = v.weight;
      variant.weightUnit = (v.weightUnit ?? "lb").toUpperCase() === "KG"
        ? "KILOGRAMS"
        : "POUNDS";
    }

    // Options
    const optionValues = Object.values(v.options).filter(Boolean);
    if (optionValues.length > 0) {
      variant.options = optionValues;
    }

    return variant;
  });

  const input: Record<string, unknown> = {
    title: product.title,
    variants,
  };

  if (product.description) input.descriptionHtml = product.description;
  if (product.vendor) input.vendor = product.vendor;
  if (product.productType) input.productType = product.productType;
  if (product.tags.length > 0) input.tags = product.tags;

  // Build option names from the first variant's options keys
  const optionKeys = Object.keys(product.variants[0]?.options ?? {});
  if (optionKeys.length > 0) {
    input.options = optionKeys;
  }

  // Media (images) — Shopify accepts external URLs via CreateMediaInput
  const media = product.images
    .filter((img) => img.sourceUrl.startsWith("http"))
    .map((img) => ({
      originalSource: img.sourceUrl,
      alt: img.altText ?? "",
      mediaContentType: "IMAGE",
    }));

  return { input, media };
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
    const result = await writeOneProduct(client, product, options.locationId, logger);
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
  locationId: string,
  logger: ReturnType<typeof getLogger>,
): Promise<WriteResult> {
  try {
    const { input, media } = buildProductInput(product, locationId);

    const res = await client.query<{
      productCreate: {
        product: { id: string; title: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(
      PRODUCT_CREATE_MUTATION,
      { input, media: media.length > 0 ? media : undefined },
      "ProductCreate",
    );

    // Check for user errors (validation failures — not retryable)
    const userErrors = res.data?.productCreate?.userErrors ?? [];
    if (userErrors.length > 0) {
      const errorMsg = userErrors.map((e) => e.message).join("; ");
      logger.warn("Product creation validation error", {
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

    const createdProduct = res.data?.productCreate?.product;
    if (!createdProduct) {
      return {
        sourceKey: product.sourceKey,
        success: false,
        errorCode: "NO_PRODUCT_RETURNED",
        errorMessage: "Product creation returned no product",
        imagesAttached: 0,
        imagesFailed: product.images.length,
      };
    }

    logger.info("Product created in Shopify", {
      sourceKey: product.sourceKey,
      shopifyProductId: createdProduct.id,
    });

    // Image count: media was submitted inline with productCreate
    // Shopify processes images asynchronously — we report based on submission
    return {
      sourceKey: product.sourceKey,
      success: true,
      shopifyProductId: createdProduct.id,
      imagesAttached: media.length,
      imagesFailed: product.images.length - media.length, // non-http URLs
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
