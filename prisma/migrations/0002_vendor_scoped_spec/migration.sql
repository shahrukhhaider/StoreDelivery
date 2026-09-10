-- Phase 1: Vendor Identity Foundation
-- Phase 2: Upload Modes
-- Phase 3: Shopify Vendor Scoping

-- UploadModeEnum (Phase 2)
DO $$ BEGIN
  CREATE TYPE "UploadModeEnum" AS ENUM ('CATALOG_UPDATE', 'INVENTORY_UPDATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- upload_mode column on catalog_uploads (Phase 2)
ALTER TABLE "catalog_uploads"
  ADD COLUMN IF NOT EXISTS "upload_mode" "UploadModeEnum" NOT NULL DEFAULT 'CATALOG_UPDATE';

-- normalized_name on supplier_profiles (Phase 1)
ALTER TABLE "supplier_profiles"
  ADD COLUMN IF NOT EXISTS "normalized_name" TEXT;

-- Backfill normalized_name for existing rows (slug from name)
UPDATE "supplier_profiles"
SET "normalized_name" = LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]+', '-', 'g'), '^-+|-+$', '', 'g'))
WHERE "normalized_name" IS NULL;

-- Make normalized_name NOT NULL after backfill
ALTER TABLE "supplier_profiles"
  ALTER COLUMN "normalized_name" SET NOT NULL;

-- Drop old unique constraint on (shop_id, schema_fingerprint) — now nullable
ALTER TABLE "supplier_profiles"
  DROP CONSTRAINT IF EXISTS "supplier_profiles_shop_id_schema_fingerprint_key";

-- Make schema_fingerprint nullable (Phase 1)
ALTER TABLE "supplier_profiles"
  ALTER COLUMN "schema_fingerprint" DROP NOT NULL;

-- Add new unique constraint on (shop_id, normalized_name) (Phase 1)
DO $$ BEGIN
  ALTER TABLE "supplier_profiles"
    ADD CONSTRAINT "supplier_profiles_shop_id_normalized_name_key"
    UNIQUE ("shop_id", "normalized_name");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- Add index on (shop_id, schema_fingerprint) for detection lookups (Phase 1)
CREATE INDEX IF NOT EXISTS "supplier_profiles_shop_id_schema_fingerprint_idx"
  ON "supplier_profiles"("shop_id", "schema_fingerprint");

-- vendor_id FK on catalogs (Phase 1)
ALTER TABLE "catalogs"
  ADD COLUMN IF NOT EXISTS "vendor_id" TEXT;

ALTER TABLE "catalogs"
  DROP CONSTRAINT IF EXISTS "catalogs_vendor_id_fkey";

ALTER TABLE "catalogs"
  ADD CONSTRAINT "catalogs_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "supplier_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "catalogs_vendor_id_idx"
  ON "catalogs"("vendor_id");

-- vendor_column_mappings table (Phase 1)
CREATE TABLE IF NOT EXISTS "vendor_column_mappings" (
  "id"               TEXT NOT NULL,
  "vendor_id"        TEXT NOT NULL,
  "source_column"    TEXT NOT NULL,
  "canonical_field"  TEXT,
  "ignored"          BOOLEAN NOT NULL DEFAULT false,
  "transform_config" JSONB,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "vendor_column_mappings_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "vendor_column_mappings"
    ADD CONSTRAINT "vendor_column_mappings_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "supplier_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "vendor_column_mappings_vendor_id_source_column_key"
  ON "vendor_column_mappings"("vendor_id", "source_column");

CREATE INDEX IF NOT EXISTS "vendor_column_mappings_vendor_id_idx"
  ON "vendor_column_mappings"("vendor_id");

-- MISSING value on ReconciliationClassification enum (Phase 3)
DO $$ BEGIN
  ALTER TYPE "ReconciliationClassification" ADD VALUE IF NOT EXISTS 'MISSING';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
