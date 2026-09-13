-- Phase 1-3 vendor scoping changes are included in 0001_baseline.
-- This migration is a no-op marker for databases that already had
-- 0001_baseline applied from a full reset.

-- Add 'update' action to ImportItemAction enum
DO $$ BEGIN
  ALTER TYPE "ImportItemAction" ADD VALUE IF NOT EXISTS 'update';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
