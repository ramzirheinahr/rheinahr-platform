-- Phase 5b-1: Versioned and Dated Facility/Client Hourly Rate Data Model
-- RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization (Phase 5b-1)

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

-- CreateIndex
CREATE INDEX IF NOT EXISTS "client_hourly_rate_versions_client_id_qualification_effective_from_effective_to_idx"
ON "client_hourly_rate_versions"("client_id", "qualification", "effective_from", "effective_to");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "client_hourly_rate_versions_client_contract_id_idx"
ON "client_hourly_rate_versions"("client_contract_id");

-- AddForeignKey
ALTER TABLE "client_hourly_rate_versions"
ADD CONSTRAINT "client_hourly_rate_versions_client_id_fkey"
FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_hourly_rate_versions"
ADD CONSTRAINT "client_hourly_rate_versions_client_contract_id_fkey"
FOREIGN KEY ("client_contract_id") REFERENCES "client_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_hourly_rate_versions"
ADD CONSTRAINT "client_hourly_rate_versions_verified_by_user_id_fkey"
FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
