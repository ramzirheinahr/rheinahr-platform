-- Phase 3c: Atomic Concurrency Hardening for Work Hours Corrections
-- RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization (Phase 3c)
-- Safely supports successive approved corrections while atomically preventing
-- competing approvals derived from the same base version.

-- 1. Safely drop the previous single-approved index if it exists
DROP INDEX IF EXISTS "work_hours_correction_requests_assignment_approved_key";

-- 2. Add base_version and revision columns if they don't already exist
ALTER TABLE "work_hours_correction_requests"
ADD COLUMN IF NOT EXISTS "base_version" TEXT;

ALTER TABLE "work_hours_correction_requests"
ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1;

-- 3. Backfill any existing records without base_version to prevent constraint failure on pre-existing data
UPDATE "work_hours_correction_requests"
SET "base_version" = COALESCE("base_version", 'legacy-' || "id")
WHERE "base_version" IS NULL;

-- 4. Create partial unique index on (assignment_id, base_version) for approved status
CREATE UNIQUE INDEX IF NOT EXISTS "work_hours_correction_requests_assignment_base_approved_key"
ON "work_hours_correction_requests" ("assignment_id", "base_version")
WHERE "status" = 'approved' AND "base_version" IS NOT NULL;

-- 5. Standard lookup indexes for fast base_version and revision queries
CREATE INDEX IF NOT EXISTS "work_hours_correction_requests_assignment_id_base_version_idx"
ON "work_hours_correction_requests" ("assignment_id", "base_version");

CREATE INDEX IF NOT EXISTS "work_hours_correction_requests_assignment_id_revision_idx"
ON "work_hours_correction_requests" ("assignment_id", "revision");
