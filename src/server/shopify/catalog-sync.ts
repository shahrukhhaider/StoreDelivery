/**
 * Shopify Catalog Bootstrap Sync
 *
 * Fetches the merchant's existing Shopify products/variants and persists
 * a local snapshot for reconciliation matching. Only stores fields needed
 * for identity — no inventory, orders, customers, collections.
 *
 * Core principle: before deciding what to create, StoreDelivery must know
 * what already exists in Shopify.
 */

import { getPrisma } from "../db.js";
import { getLogger } from "../logger.js";
import { ShopifyGraphQLClient, type GraphQLResponse } from "./graphql-client.js";
import type { ShopifyIdentityIndex } from "@shared/types/reconciliation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncResult = {
  syncId: string;
  status: "READY" | "FAILED";
  productCount: number;
  variantCount: number;
  errorCount: number;
  errorMessage?: string;
};

export type SyncStatus = {
  syncId: string | null;
  status: "NOT_SYNCED" | "SYNCING" | "READY" | "FAILED" | "STALE";
  productCount: number;
  variantCount: number;
  lastSyncedAt: string | null;
  isReady: boolean;
};

// ---------------------------------------------------------------------------
// GraphQL query — extended fields for snapshot
// ---------------------------------------------------------------------------

const SYNC_PRODUCTS_QUERY = `
  query SyncProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      edges {
        node {
          id
          title
          handle
          vendor
          status
          updatedAt
          variants(first: 100) {
            edges {
              node {
                id
                sku
                barcode
                selectedOptions {
                  name
                  value
                }
                inventoryItem {
                  id
                }
                updatedAt
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

type SyncProductEdge = {
  node: {
    id: string;
    title: string;
    handle: string;
    vendor: string | null;
    status: string;
    updatedAt: string;
    variants: {
      edges: Array<{
        node: {
          id: string;
          sku: string | null;
          barcode: string | null;
          selectedOptions: Array<{ name: string; value: string }>;
          inventoryItem: { id: string } | null;
          updatedAt: string;
        };
      }>;
    };
  };
};

type SyncProductsResult = {
  products: {
    edges: SyncProductEdge[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

/**
 * Sync the merchant's Shopify catalog into local snapshots.
 * V1: full refresh — fetches all products, upserts snapshot records.
 */
export async function syncShopifyCatalog(
  shopId: string,
  client: ShopifyGraphQLClient,
): Promise<SyncResult> {
  const prisma = getPrisma();
  const logger = getLogger();

  // Create sync record
  const sync = await prisma.shopifyCatalogSync.create({
    data: { shopId, status: "SYNCING" },
  });

  logger.info("Shopify catalog sync started", { syncId: sync.id, shopId });

  let productCount = 0;
  let variantCount = 0;
  let errorCount = 0;
  let cursor: string | null = null;

  try {
    // Track which Shopify product IDs we see — for stale removal
    const seenProductIds = new Set<string>();

    while (true) {
      const res: GraphQLResponse<SyncProductsResult> = await client.query<SyncProductsResult>(
        SYNC_PRODUCTS_QUERY,
        { cursor },
        "SyncProducts",
      );

      if (res.errors?.length) {
        errorCount++;
        logger.error("Sync page fetch error", { errors: res.errors, cursor });
        // Continue with partial data rather than failing entirely
      }

      const products = res.data?.products;
      if (!products) break;

      // Process each product
      for (const edge of products.edges) {
        try {
          const { pCount, vCount } = await upsertProductSnapshot(shopId, edge.node);
          productCount += pCount;
          variantCount += vCount;
          seenProductIds.add(edge.node.id);
        } catch (err) {
          errorCount++;
          logger.error("Failed to upsert product snapshot", {
            shopifyProductId: edge.node.id,
            error: (err as Error).message,
          });
        }
      }

      logger.debug("Sync page processed", {
        page: productCount,
        products: products.edges.length,
        hasNextPage: products.pageInfo.hasNextPage,
      });

      if (!products.pageInfo.hasNextPage) break;
      cursor = products.pageInfo.endCursor;
    }

    // Remove stale product snapshots not seen in this sync
    if (seenProductIds.size > 0) {
      const staleDeleted = await prisma.shopifyProductSnapshot.deleteMany({
        where: {
          shopId,
          shopifyProductId: { notIn: [...seenProductIds] },
        },
      });
      if (staleDeleted.count > 0) {
        logger.info("Removed stale product snapshots", { count: staleDeleted.count });
      }
    }

    // Mark sync as complete
    const finalStatus = errorCount > 0 && productCount === 0 ? "FAILED" : "READY";
    await prisma.shopifyCatalogSync.update({
      where: { id: sync.id },
      data: {
        status: finalStatus,
        productCount,
        variantCount,
        errorCount,
        completedAt: new Date(),
      },
    });

    logger.info("Shopify catalog sync complete", {
      syncId: sync.id,
      status: finalStatus,
      productCount,
      variantCount,
      errorCount,
    });

    return {
      syncId: sync.id,
      status: finalStatus as "READY" | "FAILED",
      productCount,
      variantCount,
      errorCount,
    };
  } catch (err) {
    // Fatal error — mark sync as failed
    const errorMessage = (err as Error).message;
    await prisma.shopifyCatalogSync.update({
      where: { id: sync.id },
      data: {
        status: "FAILED",
        productCount,
        variantCount,
        errorCount: errorCount + 1,
        errorMessage,
        completedAt: new Date(),
      },
    });

    logger.error("Shopify catalog sync failed", {
      syncId: sync.id,
      error: errorMessage,
    });

    return {
      syncId: sync.id,
      status: "FAILED",
      productCount,
      variantCount,
      errorCount: errorCount + 1,
      errorMessage,
    };
  }
}

// ---------------------------------------------------------------------------
// Upsert a single product + its variants
// ---------------------------------------------------------------------------

async function upsertProductSnapshot(
  shopId: string,
  product: SyncProductEdge["node"],
): Promise<{ pCount: number; vCount: number }> {
  const prisma = getPrisma();

  // Upsert product
  const productSnapshot = await prisma.shopifyProductSnapshot.upsert({
    where: {
      shopId_shopifyProductId: { shopId, shopifyProductId: product.id },
    },
    create: {
      shopId,
      shopifyProductId: product.id,
      title: product.title,
      handle: product.handle,
      vendor: product.vendor,
      status: product.status,
      updatedAtShopify: new Date(product.updatedAt),
      syncedAt: new Date(),
    },
    update: {
      title: product.title,
      handle: product.handle,
      vendor: product.vendor,
      status: product.status,
      updatedAtShopify: new Date(product.updatedAt),
      syncedAt: new Date(),
    },
  });

  // Upsert variants
  let vCount = 0;
  const seenVariantIds = new Set<string>();

  for (const variantEdge of product.variants.edges) {
    const v = variantEdge.node;
    seenVariantIds.add(v.id);

    // Extract options
    const options = v.selectedOptions ?? [];
    const option1 = options[0]?.value ?? null;
    const option2 = options[1]?.value ?? null;
    const option3 = options[2]?.value ?? null;

    await prisma.shopifyVariantSnapshot.upsert({
      where: {
        productSnapshotId_shopifyVariantId: {
          productSnapshotId: productSnapshot.id,
          shopifyVariantId: v.id,
        },
      },
      create: {
        shopifyVariantId: v.id,
        shopifyProductId: product.id,
        productSnapshotId: productSnapshot.id,
        sku: v.sku,
        barcode: v.barcode,
        option1,
        option2,
        option3,
        inventoryItemId: v.inventoryItem?.id ?? null,
        updatedAtShopify: new Date(v.updatedAt),
        syncedAt: new Date(),
      },
      update: {
        sku: v.sku,
        barcode: v.barcode,
        option1,
        option2,
        option3,
        inventoryItemId: v.inventoryItem?.id ?? null,
        updatedAtShopify: new Date(v.updatedAt),
        syncedAt: new Date(),
      },
    });
    vCount++;
  }

  // Remove stale variants for this product
  if (seenVariantIds.size > 0) {
    await prisma.shopifyVariantSnapshot.deleteMany({
      where: {
        productSnapshotId: productSnapshot.id,
        shopifyVariantId: { notIn: [...seenVariantIds] },
      },
    });
  }

  return { pCount: 1, vCount };
}

// ---------------------------------------------------------------------------
// Build ShopifyIdentityIndex from local snapshots
// ---------------------------------------------------------------------------

/**
 * Build a ShopifyIdentityIndex from persisted snapshot data.
 * Used by the reconciliation service instead of live API fetching.
 */
export async function buildIdentityIndexFromSnapshots(
  shopId: string,
): Promise<ShopifyIdentityIndex> {
  const prisma = getPrisma();
  const logger = getLogger();

  const products = await prisma.shopifyProductSnapshot.findMany({
    where: { shopId },
    include: {
      variants: {
        select: {
          shopifyVariantId: true,
          shopifyProductId: true,
          sku: true,
          barcode: true,
        },
      },
    },
  });

  const skus = new Map<string, Array<{ productId: string; variantId: string }>>();
  const barcodes = new Map<string, Array<{ productId: string; variantId: string }>>();
  const titles = new Map<string, string>();

  for (const product of products) {
    titles.set(product.title.toLowerCase().trim(), product.shopifyProductId);

    for (const variant of product.variants) {
      if (variant.sku) {
        const key = variant.sku.toLowerCase().trim();
        const existing = skus.get(key) ?? [];
        existing.push({
          productId: variant.shopifyProductId,
          variantId: variant.shopifyVariantId,
        });
        skus.set(key, existing);
      }
      if (variant.barcode) {
        const key = variant.barcode.toLowerCase().trim();
        const existing = barcodes.get(key) ?? [];
        existing.push({
          productId: variant.shopifyProductId,
          variantId: variant.shopifyVariantId,
        });
        barcodes.set(key, existing);
      }
    }
  }

  logger.info("Identity index built from snapshots", {
    shopId,
    products: products.length,
    skus: skus.size,
    barcodes: barcodes.size,
    titles: titles.size,
  });

  return { skus, barcodes, titles };
}

// ---------------------------------------------------------------------------
// Sync status helpers
// ---------------------------------------------------------------------------

/**
 * Get the current sync status for a shop.
 */
export async function getSyncStatus(shopId: string): Promise<SyncStatus> {
  const prisma = getPrisma();

  const latestSync = await prisma.shopifyCatalogSync.findFirst({
    where: { shopId },
    orderBy: { startedAt: "desc" },
  });

  if (!latestSync) {
    return {
      syncId: null,
      status: "NOT_SYNCED",
      productCount: 0,
      variantCount: 0,
      lastSyncedAt: null,
      isReady: false,
    };
  }

  return {
    syncId: latestSync.id,
    status: latestSync.status as SyncStatus["status"],
    productCount: latestSync.productCount,
    variantCount: latestSync.variantCount,
    lastSyncedAt: latestSync.completedAt?.toISOString() ?? null,
    isReady: latestSync.status === "READY",
  };
}

/**
 * Check if a shop has a valid (READY) Shopify catalog snapshot.
 * Hard invariant: unmapped products must not be classified as NEW_PRODUCT
 * without a valid snapshot.
 */
export async function hasReadySnapshot(shopId: string): Promise<boolean> {
  const prisma = getPrisma();

  const readySync = await prisma.shopifyCatalogSync.findFirst({
    where: { shopId, status: "READY" },
    orderBy: { completedAt: "desc" },
  });

  return readySync !== null;
}
