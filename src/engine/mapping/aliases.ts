/**
 * Deterministic header alias dictionary — Section 8.1
 *
 * Maps common supplier column names to canonical target fields.
 * Versioned so saved mappings can reference a specific alias set.
 */

import type { TargetField } from "@shared/types/mapping.js";

export const ALIAS_VERSION = "1";

/**
 * Normalized alias → target field.
 * Keys are lowercase, trimmed, with collapsed whitespace.
 */
export const HEADER_ALIASES: Record<string, TargetField> = {
  // --- SKU ---
  "sku": "variant.sku",
  "item no": "variant.sku",
  "item number": "variant.sku",
  "item no.": "variant.sku",
  "item #": "variant.sku",
  "part number": "variant.sku",
  "part no": "variant.sku",
  "part no.": "variant.sku",
  "part #": "variant.sku",
  "sku #": "variant.sku",
  "stock code": "variant.sku",
  "product code": "variant.sku",
  "article number": "variant.sku",
  "article no": "variant.sku",
  "article no.": "variant.sku",
  "model number": "variant.sku",
  "model no": "variant.sku",
  "model no.": "variant.sku",
  "catalog number": "variant.sku",
  "catalog no": "variant.sku",
  "item code": "variant.sku",
  "reference": "variant.sku",
  "ref": "variant.sku",
  "ref #": "variant.sku",
  "product sku": "variant.sku",
  "vendor sku": "variant.sku",
  "supplier sku": "variant.sku",

  // --- Title ---
  "title": "product.title",
  "product title": "product.title",
  "product name": "product.title",
  "name": "product.title",
  "item name": "product.title",
  "item description": "product.title",
  "short description": "product.title",
  "heading": "product.title",
  "label": "product.title",

  // --- Description ---
  "description": "product.description",
  "product description": "product.description",
  "long description": "product.description",
  "full description": "product.description",
  "details": "product.description",
  "body": "product.description",
  "body html": "product.description",
  "body (html)": "product.description",

  // --- Vendor ---
  "vendor": "product.vendor",
  "brand": "product.vendor",
  "manufacturer": "product.vendor",
  "supplier": "product.vendor",
  "brand name": "product.vendor",
  "mfg": "product.vendor",
  "make": "product.vendor",
  "company": "product.vendor",

  // --- Product Type ---
  "product type": "product.productType",
  "type": "product.productType",
  "category": "product.productType",
  "product category": "product.productType",
  "department": "product.productType",
  "collection": "product.productType",
  "class": "product.productType",

  // --- Tags ---
  "tags": "product.tags",
  "keywords": "product.tags",
  "search terms": "product.tags",

  // --- Price ---
  "price": "variant.price",
  "retail": "variant.price",
  "retail price": "variant.price",
  "selling price": "variant.price",
  "unit price": "variant.price",
  "msrp": "variant.price",
  "rrp": "variant.price",
  "sale price": "variant.price",

  // --- Compare-at Price ---
  "compare at price": "variant.compareAtPrice",
  "compare price": "variant.compareAtPrice",
  "was price": "variant.compareAtPrice",
  "original price": "variant.compareAtPrice",
  "list price": "variant.compareAtPrice",
  "regular price": "variant.compareAtPrice",
  "map": "variant.compareAtPrice",
  "map price": "variant.compareAtPrice",

  // --- Cost ---
  "cost": "variant.cost",
  "wholesale": "variant.cost",
  "wholesale price": "variant.cost",
  "cost price": "variant.cost",
  "unit cost": "variant.cost",
  "net price": "variant.cost",
  "dealer price": "variant.cost",
  "trade price": "variant.cost",

  // --- Barcode ---
  "barcode": "variant.barcode",
  "upc": "variant.barcode",
  "ean": "variant.barcode",
  "gtin": "variant.barcode",
  "isbn": "variant.barcode",
  "upc code": "variant.barcode",
  "ean code": "variant.barcode",
  "upc/ean": "variant.barcode",

  // --- Inventory ---
  "quantity": "variant.inventoryQuantity",
  "qty": "variant.inventoryQuantity",
  "stock": "variant.inventoryQuantity",
  "inventory": "variant.inventoryQuantity",
  "stock qty": "variant.inventoryQuantity",
  "stock quantity": "variant.inventoryQuantity",
  "on hand": "variant.inventoryQuantity",
  "available": "variant.inventoryQuantity",
  "available qty": "variant.inventoryQuantity",
  "in stock": "variant.inventoryQuantity",
  "inventory qty": "variant.inventoryQuantity",

  // --- Weight ---
  "weight": "variant.weight",
  "weight (lbs)": "variant.weight",
  "weight (lb)": "variant.weight",
  "weight (kg)": "variant.weight",
  "weight (oz)": "variant.weight",
  "shipping weight": "variant.weight",
  "item weight": "variant.weight",
  "product weight": "variant.weight",
  "net weight": "variant.weight",

  // --- Options ---
  "color": "variant.option1",
  "colour": "variant.option1",
  "size": "variant.option2",
  "material": "variant.option3",
  "style": "variant.option1",
  "finish": "variant.option1",
  "pattern": "variant.option2",
  "length": "variant.option2",
  "width": "variant.option3",

  // --- Images ---
  "image": "image.url",
  "image url": "image.url",
  "image link": "image.url",
  "photo": "image.url",
  "photo url": "image.url",
  "picture": "image.url",
  "picture url": "image.url",
  "main image": "image.url",
  "thumbnail": "image.url",
  "image 1": "image.url",
  "image1": "image.url",
  "image src": "image.url",
  "image source": "image.url",
  "product image": "image.url",

  // --- Grouping ---
  "parent sku": "grouping.parentKey",
  "parent id": "grouping.parentKey",
  "group id": "grouping.parentKey",
  "style number": "grouping.parentKey",
  "product id": "grouping.parentKey",
  "parent": "grouping.parentKey",
  "master sku": "grouping.parentKey",
  "family": "grouping.parentKey",
  "grouping": "grouping.parentKey",
};

/**
 * Pattern for numbered image columns: "image 2", "image3", "photo 4", etc.
 * Returns the position number if matched, null otherwise.
 */
const NUMBERED_IMAGE_RE = /^(?:image|photo|picture|img)\s*(\d+)$/;

/**
 * Normalize a header string for alias lookup.
 */
export function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    // Remove trailing periods that some suppliers use
    .replace(/\.+$/, "");
}

/**
 * Look up a header in the alias dictionary.
 * Returns the target field or null if not found.
 */
export function lookupAlias(rawHeader: string): {
  target: TargetField;
  imagePosition?: number;
} | null {
  const normalized = normalizeHeader(rawHeader);

  // Direct alias match
  const directMatch = HEADER_ALIASES[normalized];
  if (directMatch) {
    return { target: directMatch };
  }

  // Check numbered image columns
  const imageMatch = NUMBERED_IMAGE_RE.exec(normalized);
  if (imageMatch) {
    return {
      target: "image.url",
      imagePosition: parseInt(imageMatch[1], 10),
    };
  }

  return null;
}
