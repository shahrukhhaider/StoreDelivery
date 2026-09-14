-- Add warnings column to import_operations
ALTER TABLE "import_operations" ADD COLUMN IF NOT EXISTS "warnings" TEXT[] NOT NULL DEFAULT '{}';
