-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('pending', 'parsing', 'parsed', 'failed');

-- CreateEnum
CREATE TYPE "UploadModeEnum" AS ENUM ('CATALOG_UPDATE', 'INVENTORY_UPDATE');

-- CreateEnum
CREATE TYPE "MappingSourceEnum" AS ENUM ('rule', 'model', 'user');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('pending', 'ready', 'needs_review', 'blocked');

-- CreateEnum
CREATE TYPE "ImportOperationStatus" AS ENUM ('planned', 'in_progress', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ImportItemAction" AS ENUM ('create', 'skip');

-- CreateEnum
CREATE TYPE "ImportItemStatus" AS ENUM ('pending', 'success', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "OverrideSource" AS ENUM ('user', 'bulk_rule', 'auto_fix');

-- CreateEnum
CREATE TYPE "SkuSourceEnum" AS ENUM ('SUPPLIER', 'MERCHANT', 'STOREDELIVERY_GENERATED', 'NONE');

-- CreateEnum
CREATE TYPE "MappingStatusEnum" AS ENUM ('MAPPED', 'CANDIDATE_MATCH', 'AMBIGUOUS', 'UNMAPPED');

-- CreateEnum
CREATE TYPE "MatchConfidenceEnum" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "CatalogRunStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationClassification" AS ENUM ('EXISTING_MAPPED', 'LIKELY_EXISTING', 'NEW_PRODUCT', 'NEEDS_REVIEW', 'UPDATE_REVIEW', 'NO_CHANGE', 'MISSING');

-- CreateEnum
CREATE TYPE "ProposedActionEnum" AS ENUM ('CREATE_PRODUCT', 'CREATE_VARIANT', 'UPDATE_PRODUCT', 'LINK_EXISTING_PRODUCT', 'LINK_EXISTING_VARIANT', 'NO_CHANGE', 'SKIP');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('NOT_SYNCED', 'SYNCING', 'READY', 'FAILED', 'STALE');

-- CreateEnum
CREATE TYPE "UpdateSelectionStatus" AS ENUM ('PENDING', 'APPLIED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "encrypted_access_token" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMP(3),

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_uploads" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'pending',
    "upload_mode" "UploadModeEnum" NOT NULL DEFAULT 'CATALOG_UPDATE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "schema_fingerprint" TEXT NOT NULL,
    "parse_version" TEXT NOT NULL DEFAULT '1',
    "vendor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_mappings" (
    "id" TEXT NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "source_column" TEXT NOT NULL,
    "target_field" TEXT,
    "confidence" TEXT NOT NULL,
    "mapping_source" "MappingSourceEnum" NOT NULL,
    "ignored" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_products" (
    "id" TEXT NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "normalized_json" JSONB NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "catalog_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_operations" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "status" "ImportOperationStatus" NOT NULL DEFAULT 'planned',
    "idempotency_key" TEXT NOT NULL,
    "planned_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "import_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_items" (
    "id" TEXT NOT NULL,
    "import_operation_id" TEXT NOT NULL,
    "source_product_key" TEXT NOT NULL,
    "action" "ImportItemAction" NOT NULL,
    "status" "ImportItemStatus" NOT NULL DEFAULT 'pending',
    "shopify_product_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,

    CONSTRAINT "import_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_overrides" (
    "id" TEXT NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB NOT NULL,
    "source" "OverrideSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_snapshots" (
    "id" TEXT NOT NULL,
    "import_operation_id" TEXT NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "applied_overrides" JSONB NOT NULL,
    "resolved_product_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_variant_mappings" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "source_product_key" TEXT NOT NULL,
    "source_variant_key" TEXT NOT NULL,
    "source_variant_fingerprint" TEXT NOT NULL,
    "shopify_product_id" TEXT NOT NULL,
    "shopify_variant_id" TEXT NOT NULL,
    "source_sku" TEXT,
    "shopify_sku" TEXT,
    "sku_source" "SkuSourceEnum" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_variant_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_profiles" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "schema_fingerprint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_column_mappings" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "source_column" TEXT NOT NULL,
    "canonical_field" TEXT,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "transform_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_column_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_mappings" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "supplier_profile_id" TEXT NOT NULL,
    "source_product_key" TEXT NOT NULL,
    "source_product_fingerprint" TEXT NOT NULL,
    "shopify_product_id" TEXT,
    "mapping_status" "MappingStatusEnum" NOT NULL,
    "match_method" TEXT,
    "confidence" "MatchConfidenceEnum",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_mappings" (
    "id" TEXT NOT NULL,
    "product_mapping_id" TEXT NOT NULL,
    "source_variant_key" TEXT NOT NULL,
    "source_variant_fingerprint" TEXT NOT NULL,
    "source_sku" TEXT,
    "barcode" TEXT,
    "mpn" TEXT,
    "shopify_variant_id" TEXT,
    "shopify_sku" TEXT,
    "sku_source" "SkuSourceEnum" NOT NULL,
    "match_method" TEXT,
    "confidence" "MatchConfidenceEnum",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_runs" (
    "id" TEXT NOT NULL,
    "supplier_profile_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "catalog_id" TEXT,
    "source_file_hash" TEXT,
    "schema_fingerprint" TEXT,
    "status" "CatalogRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "total_products" INTEGER NOT NULL DEFAULT 0,
    "mapped_count" INTEGER NOT NULL DEFAULT 0,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "catalog_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_items" (
    "id" TEXT NOT NULL,
    "catalog_run_id" TEXT NOT NULL,
    "source_product_key" TEXT NOT NULL,
    "classification" "ReconciliationClassification" NOT NULL,
    "proposed_action" "ProposedActionEnum" NOT NULL,
    "product_mapping_id" TEXT,
    "matched_shopify_id" TEXT,
    "confidence" "MatchConfidenceEnum",
    "match_evidence" JSONB,
    "merchant_confirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_catalog_syncs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'NOT_SYNCED',
    "product_count" INTEGER NOT NULL DEFAULT 0,
    "variant_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "shopify_catalog_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_product_snapshots" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "shopify_product_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "vendor" TEXT,
    "status" TEXT,
    "updated_at_shopify" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_product_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_variant_snapshots" (
    "id" TEXT NOT NULL,
    "shopify_variant_id" TEXT NOT NULL,
    "shopify_product_id" TEXT NOT NULL,
    "product_snapshot_id" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "option1" TEXT,
    "option2" TEXT,
    "option3" TEXT,
    "inventory_item_id" TEXT,
    "updated_at_shopify" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_variant_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "update_selections" (
    "id" TEXT NOT NULL,
    "catalog_run_id" TEXT NOT NULL,
    "source_product_key" TEXT NOT NULL,
    "shopify_product_id" TEXT NOT NULL,
    "selected_fields" JSONB NOT NULL,
    "status" "UpdateSelectionStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "update_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shops_shop_domain_key" ON "shops"("shop_domain");

-- CreateIndex
CREATE INDEX "catalog_uploads_shop_id_idx" ON "catalog_uploads"("shop_id");

-- CreateIndex
CREATE INDEX "catalogs_shop_id_idx" ON "catalogs"("shop_id");

-- CreateIndex
CREATE INDEX "catalogs_vendor_id_idx" ON "catalogs"("vendor_id");

-- CreateIndex
CREATE INDEX "field_mappings_catalog_id_idx" ON "field_mappings"("catalog_id");

-- CreateIndex
CREATE INDEX "catalog_products_catalog_id_idx" ON "catalog_products"("catalog_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_products_catalog_id_source_key_key" ON "catalog_products"("catalog_id", "source_key");

-- CreateIndex
CREATE UNIQUE INDEX "import_operations_idempotency_key_key" ON "import_operations"("idempotency_key");

-- CreateIndex
CREATE INDEX "import_operations_shop_id_idx" ON "import_operations"("shop_id");

-- CreateIndex
CREATE INDEX "import_items_import_operation_id_idx" ON "import_items"("import_operation_id");

-- CreateIndex
CREATE INDEX "catalog_overrides_catalog_id_idx" ON "catalog_overrides"("catalog_id");

-- CreateIndex
CREATE INDEX "catalog_overrides_product_id_idx" ON "catalog_overrides"("product_id");

-- CreateIndex
CREATE INDEX "catalog_overrides_catalog_id_product_id_idx" ON "catalog_overrides"("catalog_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_snapshots_import_operation_id_key" ON "import_snapshots"("import_operation_id");

-- CreateIndex
CREATE INDEX "import_snapshots_catalog_id_idx" ON "import_snapshots"("catalog_id");

-- CreateIndex
CREATE INDEX "catalog_variant_mappings_shop_id_idx" ON "catalog_variant_mappings"("shop_id");

-- CreateIndex
CREATE INDEX "catalog_variant_mappings_shop_id_source_product_key_idx" ON "catalog_variant_mappings"("shop_id", "source_product_key");

-- CreateIndex
CREATE INDEX "catalog_variant_mappings_shopify_variant_id_idx" ON "catalog_variant_mappings"("shopify_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_variant_mappings_shop_id_source_variant_fingerprint_key" ON "catalog_variant_mappings"("shop_id", "source_variant_fingerprint");

-- CreateIndex
CREATE INDEX "supplier_profiles_shop_id_idx" ON "supplier_profiles"("shop_id");

-- CreateIndex
CREATE INDEX "supplier_profiles_shop_id_schema_fingerprint_idx" ON "supplier_profiles"("shop_id", "schema_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_profiles_shop_id_normalized_name_key" ON "supplier_profiles"("shop_id", "normalized_name");

-- CreateIndex
CREATE INDEX "vendor_column_mappings_vendor_id_idx" ON "vendor_column_mappings"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_column_mappings_vendor_id_source_column_key" ON "vendor_column_mappings"("vendor_id", "source_column");

-- CreateIndex
CREATE INDEX "product_mappings_shop_id_idx" ON "product_mappings"("shop_id");

-- CreateIndex
CREATE INDEX "product_mappings_supplier_profile_id_idx" ON "product_mappings"("supplier_profile_id");

-- CreateIndex
CREATE INDEX "product_mappings_shopify_product_id_idx" ON "product_mappings"("shopify_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_mappings_supplier_profile_id_source_product_key_key" ON "product_mappings"("supplier_profile_id", "source_product_key");

-- CreateIndex
CREATE INDEX "variant_mappings_product_mapping_id_idx" ON "variant_mappings"("product_mapping_id");

-- CreateIndex
CREATE INDEX "variant_mappings_shopify_variant_id_idx" ON "variant_mappings"("shopify_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_mappings_product_mapping_id_source_variant_fingerpr_key" ON "variant_mappings"("product_mapping_id", "source_variant_fingerprint");

-- CreateIndex
CREATE INDEX "catalog_runs_supplier_profile_id_idx" ON "catalog_runs"("supplier_profile_id");

-- CreateIndex
CREATE INDEX "catalog_runs_shop_id_idx" ON "catalog_runs"("shop_id");

-- CreateIndex
CREATE INDEX "run_items_catalog_run_id_idx" ON "run_items"("catalog_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "run_items_catalog_run_id_source_product_key_key" ON "run_items"("catalog_run_id", "source_product_key");

-- CreateIndex
CREATE INDEX "shopify_catalog_syncs_shop_id_idx" ON "shopify_catalog_syncs"("shop_id");

-- CreateIndex
CREATE INDEX "shopify_catalog_syncs_shop_id_status_idx" ON "shopify_catalog_syncs"("shop_id", "status");

-- CreateIndex
CREATE INDEX "shopify_product_snapshots_shop_id_idx" ON "shopify_product_snapshots"("shop_id");

-- CreateIndex
CREATE INDEX "shopify_product_snapshots_shop_id_handle_idx" ON "shopify_product_snapshots"("shop_id", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_product_snapshots_shop_id_shopify_product_id_key" ON "shopify_product_snapshots"("shop_id", "shopify_product_id");

-- CreateIndex
CREATE INDEX "shopify_variant_snapshots_product_snapshot_id_idx" ON "shopify_variant_snapshots"("product_snapshot_id");

-- CreateIndex
CREATE INDEX "shopify_variant_snapshots_sku_idx" ON "shopify_variant_snapshots"("sku");

-- CreateIndex
CREATE INDEX "shopify_variant_snapshots_barcode_idx" ON "shopify_variant_snapshots"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_variant_snapshots_product_snapshot_id_shopify_varia_key" ON "shopify_variant_snapshots"("product_snapshot_id", "shopify_variant_id");

-- CreateIndex
CREATE INDEX "update_selections_catalog_run_id_idx" ON "update_selections"("catalog_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "update_selections_catalog_run_id_source_product_key_key" ON "update_selections"("catalog_run_id", "source_product_key");

-- AddForeignKey
ALTER TABLE "catalog_uploads" ADD CONSTRAINT "catalog_uploads_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "catalog_uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "supplier_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_operations" ADD CONSTRAINT "import_operations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_operations" ADD CONSTRAINT "import_operations_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_import_operation_id_fkey" FOREIGN KEY ("import_operation_id") REFERENCES "import_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_overrides" ADD CONSTRAINT "catalog_overrides_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_overrides" ADD CONSTRAINT "catalog_overrides_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_snapshots" ADD CONSTRAINT "import_snapshots_import_operation_id_fkey" FOREIGN KEY ("import_operation_id") REFERENCES "import_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_snapshots" ADD CONSTRAINT "import_snapshots_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_variant_mappings" ADD CONSTRAINT "catalog_variant_mappings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_profiles" ADD CONSTRAINT "supplier_profiles_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_column_mappings" ADD CONSTRAINT "vendor_column_mappings_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "supplier_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_mappings" ADD CONSTRAINT "product_mappings_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_mappings" ADD CONSTRAINT "product_mappings_supplier_profile_id_fkey" FOREIGN KEY ("supplier_profile_id") REFERENCES "supplier_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_mappings" ADD CONSTRAINT "variant_mappings_product_mapping_id_fkey" FOREIGN KEY ("product_mapping_id") REFERENCES "product_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_runs" ADD CONSTRAINT "catalog_runs_supplier_profile_id_fkey" FOREIGN KEY ("supplier_profile_id") REFERENCES "supplier_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_runs" ADD CONSTRAINT "catalog_runs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_catalog_run_id_fkey" FOREIGN KEY ("catalog_run_id") REFERENCES "catalog_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_catalog_syncs" ADD CONSTRAINT "shopify_catalog_syncs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_product_snapshots" ADD CONSTRAINT "shopify_product_snapshots_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_variant_snapshots" ADD CONSTRAINT "shopify_variant_snapshots_product_snapshot_id_fkey" FOREIGN KEY ("product_snapshot_id") REFERENCES "shopify_product_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

