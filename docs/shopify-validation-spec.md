# StoreDelivery — Shopify Limit Validation

## Goal

Catch Shopify API constraint violations before import so the user sees clear blocking errors in the edit page, not cryptic Shopify API failures at write time.

## Validations

### Blocking (prevent import)

| Code | Rule | Shopify Limit |
|---|---|---|
| `MISSING_TITLE` | Product title is required | Already implemented |
| `NO_VARIANTS` | Product must have at least 1 variant | Already implemented |
| `MALFORMED_PRICE` | Price must be a valid number | Already implemented |
| `MISSING_OPTIONS` | Multi-variant product needs option values | Already implemented |
| `TOO_MANY_OPTIONS` | Max 3 option names per product | Shopify limit |
| `TOO_MANY_VARIANTS` | Max 100 variants per product | Shopify limit |
| `TITLE_TOO_LONG` | Title max 255 characters | Shopify limit |
| `OPTION_VALUE_TOO_LONG` | Option value max 255 characters | Shopify limit |
| `DUPLICATE_OPTION_VALUES` | Two variants with identical option combination | Shopify rejects |
| `NEGATIVE_PRICE` | Price must be >= 0 | Shopify rejects |

### Warning (allow import but flag)

| Code | Rule |
|---|---|
| `MISSING_SKU` | Already implemented |
| `SUSPICIOUS_HIGH_PRICE` | Already implemented |
| `SUSPICIOUS_LOW_PRICE` | Already implemented |
| `EMPTY_OPTION` | Already implemented |
| `INVALID_IMAGE_URL` | Already implemented |
| `DUPLICATE_SKU` | Already implemented |
| `DUPLICATE_BARCODE` | Already implemented |
| `AMBIGUOUS_GROUPING` | Already implemented (pipeline) |

## Principle

> Validate locally against known Shopify constraints before making API calls.
> Blocking errors prevent import. Warnings allow import but inform the merchant.
