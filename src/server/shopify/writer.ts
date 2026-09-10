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

export type VariantWriteMapping = {
  /** Index of the variant in the source product's variants array */
  sourceVariantIndex: number;
  /** Shopify variant GID returned from the mutation */
  shopifyVariantId: string;
  /** SKU on the Shopify variant after write (may differ from source) */
  shopifySku: string | null;
};

export type WriteResult = {
  sourceKey: string;
  success: boolean;
  shopifyProductId?: string;
  /** Per-variant Shopify IDs, populated on success. Order matches mutation response. */
  variantMappings?: VariantWriteMapping[];
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
  /**
   * Vendor profile ID to write as app-owned metafield on created products.
   * Also appended as a `storedelivery:vendor:<normalizedName>` tag.
   */
  vendorProfileId?: string | null;
  /** Normalized vendor name slug — used to build the vendor tag. */
  vendorNormalizedName?: string | null;
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

function buildProductSetInput(
  product: CatalogProduct,
  locationId: string | null,
  vendorProfileId?: string | null,
  vendorNormalizedName?: string | null,
): {
  productSet: Record<string, unknown>;
} {
  // First, determine product options from ALL variant data
  const productOptions = buildProductOptions(product);

  // Determine the canonical option names
  const optionNames = productOptions.map((o) => o.name);

  // If no options at all, use "Title" as default
  if (optionNames.length === 0) {
    optionNames.push("Title");
    productOptions.push({ name: "Title", values: [{ name: "Default Title" }] });
  }

  // Build variants in productSet format
  const variants = product.variants.map((v, variantIndex) => {
    const variant: Record<string, unknown> = {};

    // SKU handling per Missing SKU spec:
    // - Incoming SKU present → use it (regardless of source)
    // - Incoming SKU missing → omit (Shopify will not assign one on create,
    //   and productSet won't clear an existing one if the field is absent)
    // Never silently invent or clear a merchant-managed SKU.
    if (v.sku && v.sku.trim() !== "") {
      variant.sku = v.sku.trim();
    }

    if (v.barcode) variant.barcode = v.barcode;
    if (v.price) {
      variant.price = v.price;
    }
    if (v.compareAtPrice) variant.compareAtPrice = v.compareAtPrice;

    // Build optionValues aligned with product's declared options
    const optionValues = optionNames.map((optName) => {
      // Try to find a value for this option from the variant
      const val = v.options[optName];
      if (val) {
        return { optionName: optName, name: val };
      }
      // Fallback: unique default per variant to avoid "variant already exists"
      if (optName === "Title") {
        return {
          optionName: optName,
          name: product.variants.length > 1 ? `Variant ${variantIndex + 1}` : "Default Title",
        };
      }
      return {
        optionName: optName,
        name: product.variants.length > 1 ? `Option ${variantIndex + 1}` : "Default",
      };
    });

    variant.optionValues = optionValues;
    return variant;
  });

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

  // Vendor metafield — app-owned, authoritative scope signal for this vendor
  if (vendorProfileId) {
    productSet.metafields = [
      {
        namespace: "$app:store_delivery",
        key: "vendor_id",
        value: vendorProfileId,
        type: "single_line_text_field",
      },
    ];
  }

  // Vendor tag — human-readable visibility in Shopify Admin (advisory only)
  if (vendorNormalizedName) {
    const vendorTag = `storedelivery:vendor:${vendorNormalizedName}`;
    const existingTags: string[] = Array.isArray(productSet.tags)
      ? (productSet.tags as string[])
      : [];
    if (!existingTags.includes(vendorTag)) {
      productSet.tags = [...existingTags, vendorTag];
    }
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

  return Array.from(optionMap.entries()).map(([name, values]) => {
    const valueList = Array.from(values).map((v) => ({ name: v }));
    // Add default values for variants that don't have this option
    const hasVariantWithout = product.variants.some(
      (v) => !v.options[name],
    );
    if (hasVariantWithout) {
      // Add unique defaults for each variant without this option
      product.variants.forEach((v, idx) => {
        if (!v.options[name]) {
          const defaultVal = name === "Title"
            ? (product.variants.length > 1 ? `Variant ${idx + 1}` : "Default Title")
            : (product.variants.length > 1 ? `Option ${idx + 1}` : "Default");
          if (!valueList.some((vl) => vl.name === defaultVal)) {
            valueList.push({ name: defaultVal });
          }
        }
      });
    }
    return { name, values: valueList };
  });
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
    const result = await writeOneProduct(
      client,
      product,
      options.locationId ?? null,
      logger,
      options.vendorProfileId ?? null,
      options.vendorNormalizedName ?? null,
    );
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
  vendorProfileId: string | null = null,
  vendorNormalizedName: string | null = null,
): Promise<WriteResult> {
  try {
    const { productSet } = buildProductSetInput(product, locationId, vendorProfileId, vendorNormalizedName);
    const imageCount = product.images.filter((img) => img.sourceUrl.startsWith("http")).length;

    const res = await client.query<{
      productSet: {
        product: {
          id: string;
          title: string;
          variants: {
            edges: Array<{ node: { id: string; sku: string | null } }>;
          };
        } | null;
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

    // Extract variant-level IDs for mapping persistence
    const variantEdges = createdProduct.variants?.edges ?? [];
    const variantMappings: VariantWriteMapping[] = variantEdges.map((edge, idx) => ({
      sourceVariantIndex: idx,
      shopifyVariantId: edge.node.id,
      shopifySku: edge.node.sku ?? null,
    }));

    return {
      sourceKey: product.sourceKey,
      success: true,
      shopifyProductId: createdProduct.id,
      variantMappings,
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

/** Exported for testing */
export { buildProductSetInput as _buildProductSetInput, buildProductOptions as _buildProductOptions };
