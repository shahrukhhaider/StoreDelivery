-- Performance indexes for inline edit + large catalog queries

-- Cursor pagination on catalog_products (order by id for cursor, filter by status)
CREATE INDEX IF NOT EXISTS "catalog_products_catalog_id_status_idx"
  ON "catalog_products"("catalog_id", "status");

CREATE INDEX IF NOT EXISTS "catalog_products_catalog_id_id_idx"
  ON "catalog_products"("catalog_id", "id");

-- Override lookups by source (for clearing auto_fix vs user overrides)
CREATE INDEX IF NOT EXISTS "catalog_overrides_catalog_id_source_idx"
  ON "catalog_overrides"("catalog_id", "source");

-- Import operations lookup by status (for history + active polling)
CREATE INDEX IF NOT EXISTS "import_operations_shop_id_status_idx"
  ON "import_operations"("shop_id", "status");

-- Import operations lookup by catalog (for finding latest operation)
CREATE INDEX IF NOT EXISTS "import_operations_catalog_id_created_idx"
  ON "import_operations"("catalog_id", "created_at" DESC);

-- Import items by status (for retry failed, filter by status)
CREATE INDEX IF NOT EXISTS "import_items_operation_status_idx"
  ON "import_items"("import_operation_id", "status");
