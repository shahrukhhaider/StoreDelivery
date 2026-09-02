-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('pending', 'parsing', 'parsed', 'failed');

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

-- CreateIndex
CREATE UNIQUE INDEX "shops_shop_domain_key" ON "shops"("shop_domain");

-- CreateIndex
CREATE INDEX "catalog_uploads_shop_id_idx" ON "catalog_uploads"("shop_id");

-- CreateIndex
CREATE INDEX "catalogs_shop_id_idx" ON "catalogs"("shop_id");

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

-- AddForeignKey
ALTER TABLE "catalog_uploads" ADD CONSTRAINT "catalog_uploads_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "catalog_uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

