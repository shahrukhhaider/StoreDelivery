-- CreateEnum
CREATE TYPE "OverrideSource" AS ENUM ('user', 'bulk_rule', 'auto_fix');

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

-- AddForeignKey
ALTER TABLE "catalog_overrides" ADD CONSTRAINT "catalog_overrides_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_overrides" ADD CONSTRAINT "catalog_overrides_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_snapshots" ADD CONSTRAINT "import_snapshots_import_operation_id_fkey" FOREIGN KEY ("import_operation_id") REFERENCES "import_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_snapshots" ADD CONSTRAINT "import_snapshots_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
