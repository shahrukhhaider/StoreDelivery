/**
 * Update Writer — applies selected field changes to existing Shopify products.
 *
 * Mutations used:
 *   - productSet                    → title, description, vendor, productType, tags, images
 *                                     + variant price, compareAtPrice, barcode
 *   - inventoryItemUpdate           → cost, weight (per variant, via inventoryItem.id)
 *   - inventorySetOnHandQuantities  → inventory quantity (per variant, via locationId)
 *   - productVariantsBulkUpdate     → taxable, inventoryPolicy (per variant)
 *
 * Omitted fields remain unchanged in Shopify.
 */

import { ShopifyGraphQLClient, type GraphQLResponse } from "./graphql-client.js";
import { getPrimaryLocationId } from "./writer.js";
import { getLogger } from "../logger.js";
import type { FieldChange, VariantDiff } from "@shared/types/reconciliation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpdateRequest = {
  shopifyProductId: string;
  sourceProductKey: string;
  /** Shop domain — needed to resolve primary location for inventory updates. */
  shopDomain: string;
  productChanges: FieldChange[];
  variantChanges: VariantDiff[];
  /**
   * Map of shopifyVariantId → inventoryItemId.
   * Required for inventoryItemUpdate (cost/weight) and inventorySetOnHandQuantities.
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
// Mutation 3 — inventorySetOnHandQuantities (qty per variant × location)
// ---------------------------------------------------------------------------

const INVENTORY_SET_QUANTITIES_MUTATION = `
  mutation InventorySetOnHandQuantities($input: InventorySetOnHandQuantitiesInput!) {
    inventorySetOnHandQuantities(input: $input) {
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
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
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
 *   3. inventorySetOnHandQuantities (if inventoryQuantity selected for any variant)
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
    .filter((v) => v.changes.length > 0);

  const totalSelected =
    selectedProductChanges.length +
    selectedVariantChanges.reduce((sum, v) => sum + v.changes.length, 0);

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
      input.cost = costVal != null ? { amount: costVal, currencyCode: "USD" } : null;
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
  // Mutation 3 — inventorySetOnHandQuantities (qty)
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
      const setQuantities: Array<{ inventoryItemId: string; locationId: string; quantity: number }> = [];

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

        setQuantities.push({ inventoryItemId, locationId, quantity: qty });
      }

      if (setQuantities.length > 0) {
        try {
          const res = await client.query<{
            inventorySetOnHandQuantities: {
              inventoryAdjustmentGroup: { createdAt: string } | null;
              userErrors: Array<{ field: string[]; message: string; code: string }>;
            };
          }>(
            INVENTORY_SET_QUANTITIES_MUTATION,
            { input: { reason: "correction", setQuantities } },
            "InventorySetOnHandQuantities",
          );

          const userErrors = res.data?.inventorySetOnHandQuantities?.userErrors ?? [];
          if (userErrors.length > 0) {
            logger.warn("inventorySetOnHandQuantities validation error", {
              sourceProductKey: request.sourceProductKey,
              errors: userErrors,
            });
          }
        } catch (err) {
          logger.warn("inventorySetOnHandQuantities failed", {
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
