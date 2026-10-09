-- Phase 4a: Versioned and Freezable Facility Surcharge Policy Data Model
-- RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization (Phase 4a)

-- CreateEnum
CREATE TYPE "SurchargeCombinationRule" AS ENUM ('highest_non_night_plus_night', 'cumulative');

-- CreateEnum
CREATE TYPE "SurchargePolicySourceType" AS ENUM ('contract', 'setting', 'local_exception');

-- CreateTable
CREATE TABLE IF NOT EXISTS "facility_surcharge_policies" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_contract_id" TEXT,
    "policy_version" INTEGER NOT NULL DEFAULT 1,
    "federal_state" TEXT NOT NULL,
    "municipality" TEXT,
    "surcharge_sat" DOUBLE PRECISION NOT NULL,
    "surcharge_sun" DOUBLE PRECISION NOT NULL,
    "surcharge_holiday" DOUBLE PRECISION NOT NULL,
    "surcharge_night" DOUBLE PRECISION NOT NULL,
    "night_start" TEXT NOT NULL DEFAULT '20:00',
    "night_end" TEXT NOT NULL DEFAULT '06:00',
    "combination_rule" "SurchargeCombinationRule" NOT NULL DEFAULT 'highest_non_night_plus_night',
    "source_type" "SurchargePolicySourceType" NOT NULL DEFAULT 'setting',
    "source_reference" TEXT NOT NULL,
    "verified_by_user_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "is_frozen" BOOLEAN NOT NULL DEFAULT false,
    "frozen_at" TIMESTAMP(3),
    "frozen_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facility_surcharge_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "facility_surcharge_policies_client_id_effective_from_effective_to_idx"
ON "facility_surcharge_policies"("client_id", "effective_from", "effective_to");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "facility_surcharge_policies_client_id_policy_version_idx"
ON "facility_surcharge_policies"("client_id", "policy_version");

-- AddForeignKey
ALTER TABLE "facility_surcharge_policies"
ADD CONSTRAINT "facility_surcharge_policies_client_id_fkey"
FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_surcharge_policies"
ADD CONSTRAINT "facility_surcharge_policies_client_contract_id_fkey"
FOREIGN KEY ("client_contract_id") REFERENCES "client_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_surcharge_policies"
ADD CONSTRAINT "facility_surcharge_policies_verified_by_user_id_fkey"
FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
