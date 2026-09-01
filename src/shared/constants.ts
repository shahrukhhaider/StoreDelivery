/**
 * Application-wide constants.
 */

/** Maximum upload file size in bytes (default 50MB) */
export const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;

/** Default raw file retention in days */
export const RAW_FILE_RETENTION_DAYS = 30;

/** Number of sample values to use for type/mapping inference */
export const INFERENCE_SAMPLE_SIZE = 20;

/** Maximum products per Shopify GraphQL batch */
export const SHOPIFY_BATCH_SIZE = 10;

/** Maximum concurrent Shopify API calls */
export const SHOPIFY_MAX_CONCURRENCY = 4;
