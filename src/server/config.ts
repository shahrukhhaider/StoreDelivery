/**
 * Application configuration — loaded from environment variables.
 */

import { z } from "zod";

const configSchema = z.object({
  // Server
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),
  port: z.coerce.number().default(3000),
  logLevel: z.string().default("debug"),

  // Database
  databaseUrl: z.string().default("postgresql://user:password@localhost:5432/storekeeper"),

  // File Storage
  storageDriver: z.enum(["local", "s3"]).default("local"),
  storageLocalDir: z.string().default("./.uploads"),
  storageBucket: z.string().default("storekeeper-uploads"),
  storageEndpoint: z.string().optional(),
  storageAccessKey: z.string().optional(),
  storageSecretKey: z.string().optional(),
  storageRegion: z.string().default("us-east-1"),

  // Upload limits
  maxUploadSizeMb: z.coerce.number().default(50),
  rawFileRetentionDays: z.coerce.number().default(30),

  // Shopify (placeholder for Milestone C)
  shopifyApiKey: z.string().default(""),
  shopifyApiSecret: z.string().default(""),
  shopifyScopes: z.string().default("write_products,read_products"),
  shopifyAppUrl: z.string().default("https://localhost:3000"),
});

export type AppConfig = z.infer<typeof configSchema>;

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (_config) return _config;

  _config = configSchema.parse({
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    logLevel: process.env.LOG_LEVEL,
    databaseUrl: process.env.DATABASE_URL,
    storageDriver: process.env.STORAGE_DRIVER,
    storageLocalDir: process.env.STORAGE_LOCAL_DIR,
    storageBucket: process.env.STORAGE_BUCKET,
    storageEndpoint: process.env.STORAGE_ENDPOINT,
    storageAccessKey: process.env.STORAGE_ACCESS_KEY,
    storageSecretKey: process.env.STORAGE_SECRET_KEY,
    storageRegion: process.env.STORAGE_REGION,
    maxUploadSizeMb: process.env.MAX_UPLOAD_SIZE_MB,
    rawFileRetentionDays: process.env.RAW_FILE_RETENTION_DAYS,
    shopifyApiKey: process.env.SHOPIFY_API_KEY,
    shopifyApiSecret: process.env.SHOPIFY_API_SECRET,
    shopifyScopes: process.env.SHOPIFY_SCOPES,
    shopifyAppUrl: process.env.SHOPIFY_APP_URL,
  });

  return _config;
}

export function getConfig(): AppConfig {
  if (!_config) return loadConfig();
  return _config;
}
