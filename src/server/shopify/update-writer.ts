/**
 * Update Writer — applies selected field changes to existing Shopify products.
 *
 * Builds a partial productSet mutation including only the fields the merchant
 * selected. Omitted fields remain unchanged in Shopify.
 */

import { ShopifyGraphQLClient, type GraphQLResponse } from "./graphql-client.js";
import { getLogger } from "../logger.js";
import type { FieldChange, VariantDiff } from "@shared/types/reconciliation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpdateRequest = {
  shopifyProductId: string;
  sourceProductKey: string;
  productChanges: FieldChange[];
  variantChanges: VariantDiff[];
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
// Mutation — reuses productSet with existing product ID for updates
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
// Apply updates
// ---------------------------------------------------------------------------

/**
 * Apply selected field changes to a single Shopify product.
 */
export async function applyProductUpdate(
  client: ShopifyGraphQLClient,
  request: UpdateRequest,
): Promise<UpdateResult> {
  const logger = getLogger();

  // Build partial productSet from selected changes only
  const selectedProductChanges = request.productChanges.filter((c) => c.selected);
  const selectedVariantChanges = request.variantChanges
    .map((v) => ({
      ...v,
      changes: v.changes.filter((c) => c.selected),
    }))
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

  // Build the productSet input — only include selected fields
  const productSet: Record<string, unknown> = {
    id: request.shopifyProductId,
  };

  for (const change of selectedProductChanges) {
    switch (change.field) {
      case "title":
        productSet.title = change.supplierValue;
        break;
      case "description":
        productSet.descriptionHtml = change.supplierValue;
        break;
      case "vendor":
        productSet.vendor = change.supplierValue;
        break;
      case "productType":
        productSet.productType = change.supplierValue;
        break;
      case "tags":
        productSet.tags = change.supplierValue?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
        break;
    }
  }

  // Build variant updates — only include variants with selected changes
  if (selectedVariantChanges.length > 0) {
    const variants: Array<Record<string, unknown>> = [];

    for (const variantDiff of selectedVariantChanges) {
      if (!variantDiff.shopifyVariantId) continue;

      const variant: Record<string, unknown> = {
        id: variantDiff.shopifyVariantId,
      };

      for (const change of variantDiff.changes) {
        switch (change.field) {
          case "price":
            variant.price = change.supplierValue;
            break;
          case "compareAtPrice":
            variant.compareAtPrice = change.supplierValue;
            break;
          case "barcode":
            variant.barcode = change.supplierValue;
            break;
          // SKU is explicitly excluded — governed by provenance spec
          // Options are excluded — variant identity, not data
        }
      }

      variants.push(variant);
    }

    if (variants.length > 0) {
      productSet.variants = variants;
    }
  }

  try {
    const res = await client.query<{
      productSet: {
        product: { id: string; title: string } | null;
        userErrors: Array<{ field: string[]; message: string; code: string }>;
      };
    }>(
      PRODUCT_UPDATE_MUTATION,
      { synchronous: true, productSet },
      "ProductUpdate",
    );

    const userErrors = res.data?.productSet?.userErrors ?? [];
    if (userErrors.length > 0) {
      const errorMsg = userErrors.map((e) => e.message).join("; ");
      logger.warn("Product update validation error", {
        sourceProductKey: request.sourceProductKey,
        errors: userErrors,
      });
      return {
        sourceProductKey: request.sourceProductKey,
        shopifyProductId: request.shopifyProductId,
        success: false,
        fieldsApplied: 0,
        errorCode: "VALIDATION_ERROR",
        errorMessage: errorMsg,
      };
    }

    if (res.errors?.length) {
      const errorMsg = res.errors.map((e) => e.message).join("; ");
      return {
        sourceProductKey: request.sourceProductKey,
        shopifyProductId: request.shopifyProductId,
        success: false,
        fieldsApplied: 0,
        errorCode: "GRAPHQL_ERROR",
        errorMessage: errorMsg,
      };
    }

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
  } catch (err) {
    logger.error("Product update failed", {
      sourceProductKey: request.sourceProductKey,
      error: (err as Error).message,
    });
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
