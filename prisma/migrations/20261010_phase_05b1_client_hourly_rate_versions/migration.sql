-- Phase 5b-1: Versioned and Dated Facility/Client Hourly Rate Data Model
-- RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization (Phase 5b-1)
--
-- Architectural Guarantees:
-- 1. Provenance Preservation:
--    All foreign key relations enforce ON DELETE RESTRICT to guarantee that historical
--    audit records, facilities, contracts, and verifying users cannot be deleted while
--    dated price versions depend on them.
-- 2. Scope & Version Uniqueness:
--    Enforces unique version sequencing per client, contract scope (with COALESCE for NULL general rates),
--    and normalized (lowercase trimmed) qualification.
-- 3. Physical Non-Overlapping Exclusion Constraint:
--    Uses PostgreSQL btree_gist to physically reject overlapping validity date intervals
--    for the same client, contract scope, and normalized qualification.
-- 4. Database-Level Immutability Trigger:
--    Once a record is frozen (is_frozen = true), any UPDATE or DELETE attempt is physically
--    rejected with an exception at the PostgreSQL engine level.

-- Enable btree_gist extension for scalar + range exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateTable
CREATE TABLE IF NOT EXISTS "client_hourly_rate_versions" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_contract_id" TEXT,
    "rate_version" INTEGER NOT NULL DEFAULT 1,
    "qualification" TEXT NOT NULL,
    "hourly_rate_in_cents" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "source_type" TEXT NOT NULL DEFAULT 'contract',
    "source_reference" TEXT NOT NULL,
    "is_frozen" BOOLEAN NOT NULL DEFAULT false,
    "frozen_at" TIMESTAMP(3),
    "frozen_hash" TEXT,
    "verified_by_user_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_hourly_rate_versions_pkey" PRIMARY KEY ("id")
);

-- Basic Search Indexes
CREATE INDEX IF NOT EXISTS "client_hourly_rate_versions_client_id_qualification_effective_from_effective_to_idx"
ON "client_hourly_rate_versions"("client_id", "qualification", "effective_from", "effective_to");

CREATE INDEX IF NOT EXISTS "client_hourly_rate_versions_client_contract_id_idx"
ON "client_hourly_rate_versions"("client_contract_id");

-- Foreign Keys with Strict RESTRICT Deletion Policy
ALTER TABLE "client_hourly_rate_versions"
DROP CONSTRAINT IF EXISTS "client_hourly_rate_versions_client_id_fkey",
ADD CONSTRAINT "client_hourly_rate_versions_client_id_fkey"
FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "client_hourly_rate_versions"
DROP CONSTRAINT IF EXISTS "client_hourly_rate_versions_client_contract_id_fkey",
ADD CONSTRAINT "client_hourly_rate_versions_client_contract_id_fkey"
FOREIGN KEY ("client_contract_id") REFERENCES "client_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "client_hourly_rate_versions"
DROP CONSTRAINT IF EXISTS "client_hourly_rate_versions_verified_by_user_id_fkey",
ADD CONSTRAINT "client_hourly_rate_versions_verified_by_user_id_fkey"
FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unique Scope & Version Index (handling NULL client_contract_id and normalized qualification)
CREATE UNIQUE INDEX IF NOT EXISTS "client_hourly_rate_versions_scope_version_uidx"
ON "client_hourly_rate_versions" (
    "client_id",
    (COALESCE("client_contract_id", '00000000-0000-0000-0000-000000000000')),
    (LOWER(TRIM("qualification"))),
    "rate_version"
);

-- Physical Exclusion Constraint: Prevent Overlapping Validity Date Ranges
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'client_hourly_rate_versions_no_overlap'
    ) THEN
        ALTER TABLE "client_hourly_rate_versions"
        ADD CONSTRAINT "client_hourly_rate_versions_no_overlap"
        EXCLUDE USING gist (
            "client_id" WITH =,
            (COALESCE("client_contract_id", '00000000-0000-0000-0000-000000000000')) WITH =,
            (LOWER(TRIM("qualification"))) WITH =,
            daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&
        );
    END IF;
END $$;

-- Database-Level Immutability Trigger for Frozen Price Versions
CREATE OR REPLACE FUNCTION check_client_hourly_rate_version_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- Prevent deletion of an already frozen record
    IF TG_OP = 'DELETE' THEN
        IF OLD."is_frozen" = true THEN
            RAISE EXCEPTION 'Frozen client hourly rate version % cannot be deleted.', OLD.id;
        END IF;
        RETURN OLD;
    END IF;

    -- Prevent modification of an already frozen record
    IF TG_OP = 'UPDATE' THEN
        IF OLD."is_frozen" = true THEN
            RAISE EXCEPTION 'Frozen client hourly rate version % cannot be modified.', OLD.id;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_hourly_rate_versions_immutability ON "client_hourly_rate_versions";
CREATE TRIGGER trg_client_hourly_rate_versions_immutability
BEFORE UPDATE OR DELETE ON "client_hourly_rate_versions"
FOR EACH ROW
EXECUTE FUNCTION check_client_hourly_rate_version_immutability();
