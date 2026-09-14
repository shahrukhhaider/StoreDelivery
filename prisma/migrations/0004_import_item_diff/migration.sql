-- Add applied_diff column to import_items for storing field-level diffs after update imports
ALTER TABLE "import_items" ADD COLUMN IF NOT EXISTS "applied_diff" JSONB;
