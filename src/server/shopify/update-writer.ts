/**
 * Update Writer — applies selected field changes to existing Shopify products.
 *
 * Mutations used:
 *   - productSet                    → title, description, vendor, productType, tags, images
 *                                     + variant price, compareAtPrice, barcode
 *   - inventoryItemUpdate           → cost, weight (per variant, via inventoryItem.id)
 *   - inventorySetQuantities          → inventory quantity (per variant, via locationId)
 *   - productVariantsBulkUpdate     → taxable, inventoryPolicy (per variant)
 *
 * Omitted fields remain unchanged in Shopify.
 */

import { ShopifyGraphQLClient, type GraphQLResponse } from "./graphql-client.js";
import { getPrimaryLocationId } from "./writer.js";
import { getPrisma } from "../db.js";
import { computeVariantFingerprint } from "../../engine/sku/variant-fingerprint.js";
import { getLogger } from "../logger.js";
import type { FieldChange, VariantDiff } from "@shared/types/reconciliation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpdateRequest = {
  shopifyProductId: string;
  sourceProductKey: string;
  /** Shop ID — needed to persist variant mappings for added variants. */
  shopId: string;
  /** Shop domain — needed to resolve primary location for inventory updates. */
  shopDomain: string;
  /** Full supplier product — needed to get variant data for added variants. */
  supplierProduct: import("@shared/types/catalog.js").CatalogProduct;
  productChanges: FieldChange[];
  variantChanges: VariantDiff[];
  /**
   * Map of shopifyVariantId → inventoryItemId.
   * Required for inventoryItemUpdate (cost/weight) and inventorySetQuantities.
   */
  inventoryItemIds: Map<string, string>;
};

export type UpdateResult = {
  sourceProductKey: string;
  shopifyProductId: string;
  success: boolean;
  fieldsApplied: number;
  errorCode?: string;
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// Mutation 1 — productSet (product fields + price/compareAtPrice/barcode)
// ---------------------------------------------------------------------------

const PRODUCT_UPDATE_MUTATION = `
  mutation ProductUpdate($synchronous: Boolean!, $productSet: ProductSetInput!) {
    productSet(synchronous: $synchronous, input: $productSet) {
      product {
        id
        title
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
// Mutation 2 — inventoryItemUpdate (cost + weight per variant)
// ---------------------------------------------------------------------------

const INVENTORY_ITEM_UPDATE_MUTATION = `
  mutation InventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        id
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
// Mutation 3 — inventorySetQuantities (qty per variant × location)
// Replaces deprecated inventorySetOnHandQuantities (deprecated 2024-07).
// As of 2026-04 the @idempotent directive is REQUIRED.
// compareQuantity is MANDATORY (pass null to skip compare-and-swap check).
// ---------------------------------------------------------------------------

const INVENTORY_SET_QUANTITIES_MUTATION = `
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) @idempotent(key: $idempotencyKey) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        createdAt
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
// Mutation 4 — productVariantsBulkUpdate (taxable + inventoryPolicy)
// ---------------------------------------------------------------------------

const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = `
  mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: true) {
      productVariants {
        id
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
// Mutation 5 — productVariantsBulkCreate (add new variants to existing product)
// ---------------------------------------------------------------------------

const PRODUCT_VARIANTS_BULK_CREATE_MUTATION = `
  mutation ProductVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants {
        id
        sku
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
// Helpers
// ---------------------------------------------------------------------------

function hasField(changes: FieldChange[], field: string): boolean {
  return changes.some((c) => c.selected && c.field === field);
}

function getValue(changes: FieldChange[], field: string): string | null {
  return changes.find((c) => c.selected && c.field === field)?.supplierValue ?? null;
}

// ---------------------------------------------------------------------------
// Apply updates
// ---------------------------------------------------------------------------

/**
 * Apply selected field changes to a single Shopify product.
 *
 * Runs up to 4 mutations in sequence:
 *   1. productSet (always, if any product/basic-variant fields selected)
 *   2. inventoryItemUpdate per variant (if cost or weight selected)
 *   3. inventorySetQuantities (if inventoryQuantity selected for any variant)
 *   4. productVariantsBulkUpdate (if taxable or inventoryPolicy selected for any variant)
 */
export async function applyProductUpdate(
  client: ShopifyGraphQLClient,
  request: UpdateRequest,
): Promise<UpdateResult> {
  const logger = getLogger();

  const selectedProductChanges = request.productChanges.filter((c) => c.selected);
  const selectedVariantChanges = request.variantChanges
    .map((v) => ({ ...v, changes: v.changes.filter((c) => c.selected) }))
    // Keep variants with selected field changes OR lifecycle status (added/discontinued)
    .filter((v) => v.changes.length > 0 || v.status === "added" || v.status === "discontinued");

  const totalSelected =
    selectedProductChanges.length +
    selectedVariantChanges.reduce((sum, v) => {
      // Added/discontinued each count as 1 action even though changes[] is empty
      if (v.status === "added" || v.status === "discontinued") return sum + 1;
      return sum + v.changes.length;
    }, 0);

  if (totalSelected === 0) {
    return {
      sourceProductKey: request.sourceProductKey,
      shopifyProductId: request.shopifyProductId,
      success: true,
      fieldsApplied: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Mutation 1 — productSet
  // -------------------------------------------------------------------------

  // Fields handled by productSet at product level: title, description, vendor, productType, tags
  // Fields handled by productSet at variant level: price, compareAtPrice, barcode
  const PRODUCT_SET_VARIANT_FIELDS = new Set(["price", "compareAtPrice", "barcode"]);

  const productSetInput: Record<string, unknown> = {
    id: request.shopifyProductId,
  };

  for (const change of selectedProductChanges) {
    switch (change.field) {
      case "title":
        productSetInput.title = change.supplierValue;
        break;
      case "description":
        productSetInput.descriptionHtml = change.supplierValue;
        break;
      case "vendor":
        productSetInput.vendor = change.supplierValue;
        break;
      case "productType":
        productSetInput.productType = change.supplierValue;
        break;
      case "tags":
        productSetInput.tags =
          change.supplierValue?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
        break;
      case "images":
        // Images are re-sent as files — use the supplier product's image list
        // (the supplierProduct field carries the full CatalogProduct)
        if (request.supplierProduct.images.length > 0) {
          productSetInput.files = request.supplierProduct.images
            .filter((img) => img.sourceUrl.startsWith("http"))
            .map((img) => ({
              originalSource: img.sourceUrl,
              alt: img.altText ?? "",
              contentType: "IMAGE",
            }));
        }
        break;
    }
  }

  const productSetVariants: Array<Record<string, unknown>> = [];
  for (const variantDiff of selectedVariantChanges) {
    if (!variantDiff.shopifyVariantId) continue;
    const basicChanges = variantDiff.changes.filter((c) => PRODUCT_SET_VARIANT_FIELDS.has(c.field));
    if (basicChanges.length === 0) continue;

    const v: Record<string, unknown> = { id: variantDiff.shopifyVariantId };
    for (const c of basicChanges) {
      switch (c.field) {
        case "price":          v.price = c.supplierValue; break;
        case "compareAtPrice": v.compareAtPrice = c.supplierValue; break;
        case "barcode":        v.barcode = c.supplierValue; break;
      }
    }
    productSetVariants.push(v);
  }

  if (productSetVariants.length > 0) {
    productSetInput.variants = productSetVariants;
  }

  const hasProductSetWork =
    Object.keys(productSetInput).length > 1 || productSetVariants.length > 0;

  if (hasProductSetWork) {
    try {
      const res = await client.query<{
        productSet: {
          product: { id: string; title: string } | null;
          userErrors: Array<{ field: string[]; message: string; code: string }>;
        };
      }>(PRODUCT_UPDATE_MUTATION, { synchronous: true, productSet: productSetInput }, "ProductUpdate");

      const userErrors = res.data?.productSet?.userErrors ?? [];
      if (userErrors.length > 0) {
        const msg = userErrors.map((e) => e.message).join("; ");
        logger.warn("productSet validation error", { sourceProductKey: request.sourceProductKey, errors: userErrors });
        return {
          sourceProductKey: request.sourceProductKey,
          shopifyProductId: request.shopifyProductId,
          success: false,
          fieldsApplied: 0,
          errorCode: "VALIDATION_ERROR",
          errorMessage: msg,
        };
      }
      if (res.errors?.length) {
        const msg = res.errors.map((e) => e.message).join("; ");
        return {
          sourceProductKey: request.sourceProductKey,
          shopifyProductId: request.shopifyProductId,
          success: false,
          fieldsApplied: 0,
          errorCode: "GRAPHQL_ERROR",
          errorMessage: msg,
        };
      }
    } catch (err) {
      return {
        sourceProductKey: request.sourceProductKey,
        shopifyProductId: request.shopifyProductId,
        success: false,
        fieldsApplied: 0,
        errorCode: "UPDATE_ERROR",
        errorMessage: (err as Error).message,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Mutation 2 — inventoryItemUpdate (cost + weight per variant)
  // -------------------------------------------------------------------------

  const INVENTORY_ITEM_FIELDS = new Set(["cost", "weight"]);

  for (const variantDiff of selectedVariantChanges) {
    if (!variantDiff.shopifyVariantId) continue;
    const invChanges = variantDiff.changes.filter((c) => INVENTORY_ITEM_FIELDS.has(c.field));
    if (invChanges.length === 0) continue;

    const inventoryItemId = request.inventoryItemIds.get(variantDiff.shopifyVariantId);
    if (!inventoryItemId) {
      logger.warn("inventoryItemId missing for variant — skipping cost/weight update", {
        shopifyVariantId: variantDiff.shopifyVariantId,
      });
      continue;
    }

    const input: Record<string, unknown> = {};

    if (hasField(invChanges, "cost")) {
      const costVal = getValue(invChanges, "cost");
      // InventoryItemInput.cost is a plain Decimal scalar — shop's default currency is assumed.
      // Do NOT wrap in { amount, currencyCode } — that's MoneyInput, which is a different type.
      input.cost = costVal ?? null;
    }

    // weight field stores "value unit" string with canonical Shopify unit (e.g. "1.5 KILOGRAMS")
    // Unit is normalised by the diff engine before storage.
    if (hasField(invChanges, "weight")) {
      const weightStr = getValue(invChanges, "weight");
      if (weightStr) {
        const parts = weightStr.trim().split(/\s+/);
        const value = parseFloat(parts[0] ?? "0");
        const unit = parts[1] ?? "KILOGRAMS";
        if (!isNaN(value)) {
          input.measurement = { weight: { value, unit } };
        }
      }
    }

    if (Object.keys(input).length === 0) continue;

    try {
      const res = await client.query<{
        inventoryItemUpdate: {
          inventoryItem: { id: string } | null;
          userErrors: Array<{ field: string[]; message: string; code: string }>;
        };
      }>(INVENTORY_ITEM_UPDATE_MUTATION, { id: inventoryItemId, input }, "InventoryItemUpdate");

      const userErrors = res.data?.inventoryItemUpdate?.userErrors ?? [];
      if (userErrors.length > 0) {
        logger.warn("inventoryItemUpdate validation error", {
          shopifyVariantId: variantDiff.shopifyVariantId,
          errors: userErrors,
        });
        // Non-fatal — continue with remaining variants and mutations
      }
    } catch (err) {
      logger.warn("inventoryItemUpdate failed", {
        shopifyVariantId: variantDiff.shopifyVariantId,
        error: (err as Error).message,
      });
      // Non-fatal
    }
  }

  // -------------------------------------------------------------------------
  // Mutation 3 — inventorySetQuantities (qty)
  // Uses inventorySetQuantities (replaces deprecated inventorySetOnHandQuantities).
  // @idempotent directive required as of 2026-04 — generate a UUID per call.
  // compareQuantity: null opts out of compare-and-swap (safe for our use case).
  // -------------------------------------------------------------------------

  const qtyVariants = selectedVariantChanges.filter((v) =>
    v.changes.some((c) => c.field === "inventoryQuantity"),
  );

  if (qtyVariants.length > 0) {
    // Resolve location ID lazily — only when we actually need qty updates
    const locationId = await getPrimaryLocationId(client, request.shopDomain);

    if (!locationId) {
      logger.warn("No primary location found — skipping inventory quantity updates", {
        sourceProductKey: request.sourceProductKey,
      });
    } else {
      const quantities: Array<{
        inventoryItemId: string;
        locationId: string;
        quantity: number;
        compareQuantity: null;
        name: string;
      }> = [];

      for (const variantDiff of qtyVariants) {
        if (!variantDiff.shopifyVariantId) continue;
        const inventoryItemId = request.inventoryItemIds.get(variantDiff.shopifyVariantId);
        if (!inventoryItemId) {
          logger.warn("inventoryItemId missing for variant — skipping qty update", {
            shopifyVariantId: variantDiff.shopifyVariantId,
          });
          continue;
        }

        const qtyStr = getValue(variantDiff.changes, "inventoryQuantity");
        const qty = qtyStr != null ? parseInt(qtyStr, 10) : NaN;
        if (isNaN(qty)) continue;

        quantities.push({
          inventoryItemId,
          locationId,
          quantity: qty,
          compareQuantity: null,  // opt out of compare-and-swap
          name: "on_hand",
        });
      }

      if (quantities.length > 0) {
        try {
          const idempotencyKey = crypto.randomUUID();
          const res = await client.query<{
            inventorySetQuantities: {
              inventoryAdjustmentGroup: { createdAt: string } | null;
              userErrors: Array<{ field: string[]; message: string; code: string }>;
            };
          }>(
            INVENTORY_SET_QUANTITIES_MUTATION,
            {
              input: {
                reason: "correction",
                referenceDocumentUri: `gid://storekeeper/UpdateRequest/${request.sourceProductKey}`,
                quantities,
                ignoreCompareQuantity: true,
              },
              idempotencyKey,
            },
            "InventorySetQuantities",
          );

          const userErrors = res.data?.inventorySetQuantities?.userErrors ?? [];
          if (userErrors.length > 0) {
            logger.warn("inventorySetQuantities validation error", {
              sourceProductKey: request.sourceProductKey,
              errors: userErrors,
            });
          }
        } catch (err) {
          logger.warn("inventorySetQuantities failed", {
            sourceProductKey: request.sourceProductKey,
            error: (err as Error).message,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Mutation 4 — productVariantsBulkUpdate (taxable + inventoryPolicy)
  // -------------------------------------------------------------------------

  const BULK_VARIANT_FIELDS = new Set(["taxable", "inventoryPolicy"]);

  const bulkVariants: Array<Record<string, unknown>> = [];
  for (const variantDiff of selectedVariantChanges) {
    if (!variantDiff.shopifyVariantId) continue;
    const bulkChanges = variantDiff.changes.filter((c) => BULK_VARIANT_FIELDS.has(c.field));
    if (bulkChanges.length === 0) continue;

    const v: Record<string, unknown> = { id: variantDiff.shopifyVariantId };
    for (const c of bulkChanges) {
      switch (c.field) {
        case "taxable":
          v.taxable = c.supplierValue === "true";
          break;
        case "inventoryPolicy":
          v.inventoryPolicy = c.supplierValue?.toUpperCase() ?? "DENY";
          break;
      }
    }
    bulkVariants.push(v);
  }

  if (bulkVariants.length > 0) {
    try {
      const res = await client.query<{
        productVariantsBulkUpdate: {
          productVariants: Array<{ id: string }> | null;
          userErrors: Array<{ field: string[]; message: string; code: string }>;
        };
      }>(
        PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
        { productId: request.shopifyProductId, variants: bulkVariants },
        "ProductVariantsBulkUpdate",
      );

      const userErrors = res.data?.productVariantsBulkUpdate?.userErrors ?? [];
      if (userErrors.length > 0) {
        logger.warn("productVariantsBulkUpdate validation error", {
          sourceProductKey: request.sourceProductKey,
          errors: userErrors,
        });
      }
    } catch (err) {
      logger.warn("productVariantsBulkUpdate failed", {
        sourceProductKey: request.sourceProductKey,
        error: (err as Error).message,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Mutation 5 — productVariantsBulkCreate (add new variants)
  // -------------------------------------------------------------------------

  const addedVariantDiffs = selectedVariantChanges.filter((v) => v.status === "added");

  if (addedVariantDiffs.length > 0) {
    // Build supplier variant lookup from the full supplier product
    const supplierVariantByKey = new Map(
      request.supplierProduct.variants.map((v) => [v.sourceKey, v]),
    );

    const newVariants: Array<Record<string, unknown>> = [];

    for (const variantDiff of addedVariantDiffs) {
      const sv = supplierVariantByKey.get(variantDiff.sourceVariantKey);
      if (!sv) continue;

      const v: Record<string, unknown> = {};
      if (sv.price != null) v.price = sv.price;
      if (sv.compareAtPrice != null) v.compareAtPrice = sv.compareAtPrice;
      if (sv.barcode != null) v.barcode = sv.barcode;
      if (sv.sku != null) v.sku = sv.sku;

      // Option values — required to distinguish variants in Shopify
      if (sv.options && Object.keys(sv.options).length > 0) {
        v.optionValues = Object.entries(sv.options).map(([name, value]) => ({
          name: value,
          optionName: name,
        }));
      }

      // Inventory item (cost + weight)
      const invInput: Record<string, unknown> = {};
      if (sv.cost != null) invInput.cost = sv.cost;
      if (sv.weight != null && sv.weightUnit != null) {
        invInput.measurement = { weight: { value: sv.weight, unit: sv.weightUnit.toUpperCase() } };
      }
      if (Object.keys(invInput).length > 0) v.inventoryItem = invInput;

      if (sv.taxable != null) v.taxable = sv.taxable;
      if (sv.inventoryPolicy != null) v.inventoryPolicy = sv.inventoryPolicy.toUpperCase();

      newVariants.push(v);
    }

    if (newVariants.length > 0) {
      try {
        const res = await client.query<{
          productVariantsBulkCreate: {
            productVariants: Array<{ id: string; sku: string | null }> | null;
            userErrors: Array<{ field: string[]; message: string; code: string }>;
          };
        }>(
          PRODUCT_VARIANTS_BULK_CREATE_MUTATION,
          { productId: request.shopifyProductId, variants: newVariants },
          "ProductVariantsBulkCreate",
        );

        const userErrors = res.data?.productVariantsBulkCreate?.userErrors ?? [];
        if (userErrors.length > 0) {
          logger.warn("productVariantsBulkCreate validation error", {
            sourceProductKey: request.sourceProductKey,
            errors: userErrors,
          });
        } else {
          const createdVariants = res.data?.productVariantsBulkCreate?.productVariants ?? [];
          logger.info("New variants added to product", {
            sourceProductKey: request.sourceProductKey,
            count: createdVariants.length,
          });

          // Persist variant mappings for newly created variants so subsequent
          // uploads diff them correctly instead of re-showing them as "added".
          await persistAddedVariantMappings(
            request.shopId,
            request.shopifyProductId,
            request.supplierProduct,
            addedVariantDiffs.map((v) => v.sourceVariantKey),
            createdVariants,
          );
        }
      } catch (err) {
        logger.warn("productVariantsBulkCreate failed", {
          sourceProductKey: request.sourceProductKey,
          error: (err as Error).message,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Done
  // -------------------------------------------------------------------------

  logger.info("Product updated in Shopify", {
    sourceProductKey: request.sourceProductKey,
    shopifyProductId: request.shopifyProductId,
    fieldsApplied: totalSelected,
  });

  return {
    sourceProductKey: request.sourceProductKey,
    shopifyProductId: request.shopifyProductId,
    success: true,
    fieldsApplied: totalSelected,
  };
}

// ---------------------------------------------------------------------------
// Persist variant mappings for newly added variants
// ---------------------------------------------------------------------------

/**
 * After a successful productVariantsBulkCreate, persist CatalogVariantMapping
 * records for each new variant so subsequent uploads can diff them correctly
 * instead of re-showing them as "added".
 *
 * @param shopId         - Shop ID
 * @param shopifyProductId - GID of the product the variants were added to
 * @param supplierProduct  - Full supplier product (source of variant data)
 * @param addedSourceKeys  - sourceVariantKeys that were just created (in order)
 * @param createdVariants  - Shopify response: [{id, sku}] (in same order)
 */
async function persistAddedVariantMappings(
  shopId: string,
  shopifyProductId: string,
  supplierProduct: import("@shared/types/catalog.js").CatalogProduct,
  addedSourceKeys: string[],
  createdVariants: Array<{ id: string; sku: string | null }>,
): Promise<void> {
  const logger = getLogger();
  const prisma = getPrisma();

  // Build lookup: sourceVariantKey → CatalogVariant + index in the full product
  const variantByKey = new Map(
    supplierProduct.variants.map((v, i) => [v.sourceKey, { variant: v, index: i }]),
  );

  for (let i = 0; i < addedSourceKeys.length; i++) {
    const sourceKey = addedSourceKeys[i];
    const shopifyVariant = createdVariants[i];
    if (!sourceKey || !shopifyVariant) continue;

    const entry = variantByKey.get(sourceKey);
    if (!entry) continue;

    const fingerprint = computeVariantFingerprint(
      supplierProduct.sourceKey,
      entry.variant,
      entry.index,
    );

    const sourceSku = entry.variant.sku?.trim() || null;
    const shopifySku = shopifyVariant.sku || null;
    const skuSource: "SUPPLIER" | "MERCHANT" | "STOREDELIVERY_GENERATED" | "NONE" =
      entry.variant.skuSource ?? (sourceSku ? "SUPPLIER" : "NONE");

    try {
      await prisma.catalogVariantMapping.upsert({
        where: { shopId_sourceVariantFingerprint: { shopId, sourceVariantFingerprint: fingerprint } },
        create: {
          shopId,
          sourceProductKey: supplierProduct.sourceKey,
          sourceVariantKey: sourceKey,
          sourceVariantFingerprint: fingerprint,
          shopifyProductId,
          shopifyVariantId: shopifyVariant.id,
          sourceSku,
          shopifySku,
          skuSource,
        },
        update: {
          shopifyProductId,
          shopifyVariantId: shopifyVariant.id,
          sourceVariantKey: sourceKey,
          sourceSku,
          shopifySku,
          skuSource,
        },
      });
    } catch (err) {
      logger.error("Failed to persist added variant mapping", {
        shopId,
        sourceVariantKey: sourceKey,
        fingerprint,
        error: (err as Error).message,
      });
    }
  }

  logger.debug("Added variant mappings persisted", {
    shopId,
    shopifyProductId,
    count: addedSourceKeys.length,
  });
}
