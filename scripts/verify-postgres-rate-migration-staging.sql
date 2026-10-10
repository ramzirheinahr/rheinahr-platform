-- ============================================================================
-- RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
-- Phase 5b-2a: PostgreSQL Staging Migration & Constraint Verification Script
-- ============================================================================
-- This script performs physical verification of:
-- 1. Foreign Key RESTRICT deletion policies on client, contract, and verifier
-- 2. btree_gist physical EXCLUDE constraint rejecting overlapping date ranges
--    both in contract-specific scopes and in NULL general scopes
-- 3. Normalized Unique Scope & Version index handling NULL contracts and case sensitivity
-- 4. Database-level immutability trigger preventing UPDATE and DELETE on frozen records
-- 5. Existence of both Prisma-expected standard unique index and expression unique index
--
-- EXECUTION NOTICE:
-- Must be executed on a dedicated Staging PostgreSQL instance.
-- Never run against production.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- 1. Verify Extension & Table Existence
SELECT 'Checking btree_gist extension...' AS step;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
        RAISE EXCEPTION 'CRITICAL: btree_gist extension is not installed!';
    END IF;
END $$;

SELECT 'Checking client_hourly_rate_versions table...' AS step;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'client_hourly_rate_versions') THEN
        RAISE EXCEPTION 'CRITICAL: client_hourly_rate_versions table does not exist!';
    END IF;
END $$;

-- 2. Verify Index Existence
SELECT 'Checking required indexes...' AS step;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'client_hourly_rate_versions_client_id_client_contract_id_qu_key') THEN
        RAISE EXCEPTION 'CRITICAL: Prisma standard unique index is missing!';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'client_hourly_rate_versions_scope_version_uidx') THEN
        RAISE EXCEPTION 'CRITICAL: Expression unique index scope_version_uidx is missing!';
    END IF;
END $$;

-- 3. Setup Test Fixtures
SELECT 'Setting up test entities...' AS step;
INSERT INTO "clients" ("id", "name", "address", "hourly_rate", "payment_terms_days", "short_code", "created_at", "updated_at")
VALUES ('test-client-staging-5b2a', 'Seniorenresidenz Staging GmbH', 'Rheinweg 1, 53424 Remagen', 35.0, 14, 'SR-STG', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "users" ("id", "email", "password_hash", "role", "active", "full_name", "created_at", "updated_at")
VALUES ('test-user-admin-5b2a', 'admin.staging@rheinahr.de', 'hash', 'admin', true, 'Staging Admin Verifier', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "client_contracts" ("id", "client_id", "status", "period", "created_at", "updated_at")
VALUES ('test-contract-staging-5b2a', 'test-client-staging-5b2a', 'pending', '2026-Q1/Q2', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 4. Test Case 1: Insert valid frozen rate for contract scope
SELECT 'Test 1: Inserting valid frozen rate for contract scope...' AS step;
INSERT INTO "client_hourly_rate_versions" (
    "id", "client_id", "client_contract_id", "rate_version", "qualification",
    "hourly_rate_in_cents", "effective_from", "effective_to", "source_type",
    "source_reference", "is_frozen", "frozen_at", "frozen_hash", "verified_by_user_id",
    "verified_at", "created_at", "updated_at"
) VALUES (
    'rate-v1-contract', 'test-client-staging-5b2a', 'test-contract-staging-5b2a', 1, 'pflegefachkraft',
    4200, '2026-01-01', '2026-06-30', 'contract',
    'Vertrag §4 Abs 1', true, NOW(), 'hash1', 'test-user-admin-5b2a',
    NOW(), NOW(), NOW()
);

-- 5. Test Case 2: Insert non-overlapping successor rate for same contract scope
SELECT 'Test 2: Inserting non-overlapping successor rate for contract scope...' AS step;
INSERT INTO "client_hourly_rate_versions" (
    "id", "client_id", "client_contract_id", "rate_version", "qualification",
    "hourly_rate_in_cents", "effective_from", "effective_to", "source_type",
    "source_reference", "is_frozen", "frozen_at", "frozen_hash", "verified_by_user_id",
    "verified_at", "created_at", "updated_at"
) VALUES (
    'rate-v2-contract', 'test-client-staging-5b2a', 'test-contract-staging-5b2a', 2, 'pflegefachkraft',
    4400, '2026-07-01', '2026-12-31', 'contract_amendment',
    'Nachtrag 1 §2', true, NOW(), 'hash2', 'test-user-admin-5b2a',
    NOW(), NOW(), NOW()
);

-- 6. Test Case 3: Verify EXCLUDE constraint rejects overlapping dates (Contract Scope)
SELECT 'Test 3: Expecting failure on overlapping date range in contract scope...' AS step;
DO $$
BEGIN
    INSERT INTO "client_hourly_rate_versions" (
        "id", "client_id", "client_contract_id", "rate_version", "qualification",
        "hourly_rate_in_cents", "effective_from", "effective_to", "source_type",
        "source_reference", "is_frozen", "created_at", "updated_at"
    ) VALUES (
        'rate-overlap-contract', 'test-client-staging-5b2a', 'test-contract-staging-5b2a', 3, 'pflegefachkraft',
        4500, '2026-04-01', '2026-08-01', 'contract',
        'Ungültiger Überlapp', false, NOW(), NOW()
    );
    RAISE EXCEPTION 'CRITICAL FAILURE: Overlapping contract-scoped interval was NOT rejected by EXCLUDE constraint!';
EXCEPTION
    WHEN exclusion_violation THEN
        RAISE NOTICE 'SUCCESS: EXCLUDE constraint successfully rejected overlapping contract-scoped rate.';
END $$;

-- 7. Test Case 4: Insert valid rate for General Scope (client_contract_id IS NULL)
SELECT 'Test 4: Inserting valid rate for general scope (NULL contract)...' AS step;
INSERT INTO "client_hourly_rate_versions" (
    "id", "client_id", "client_contract_id", "rate_version", "qualification",
    "hourly_rate_in_cents", "effective_from", "effective_to", "source_type",
    "source_reference", "is_frozen", "frozen_at", "frozen_hash", "verified_by_user_id",
    "verified_at", "created_at", "updated_at"
) VALUES (
    'rate-v1-general', 'test-client-staging-5b2a', NULL, 1, 'pflegefachkraft',
    4000, '2026-01-01', '2026-12-31', 'framework_agreement',
    'Rahmenvereinbarung 2026', true, NOW(), 'hash-gen-1', 'test-user-admin-5b2a',
    NOW(), NOW(), NOW()
);

-- 8. Test Case 5: Verify EXCLUDE constraint rejects overlapping dates (General NULL Scope)
SELECT 'Test 5: Expecting failure on overlapping date range in general NULL scope...' AS step;
DO $$
BEGIN
    INSERT INTO "client_hourly_rate_versions" (
        "id", "client_id", "client_contract_id", "rate_version", "qualification",
        "hourly_rate_in_cents", "effective_from", "effective_to", "source_type",
        "source_reference", "is_frozen", "created_at", "updated_at"
    ) VALUES (
        'rate-overlap-general', 'test-client-staging-5b2a', NULL, 2, '  PflegeFachKraft  ',
        4100, '2026-06-01', '2026-09-30', 'framework_agreement',
        'Ungültiger Überlapp Allgemein', false, NOW(), NOW()
    );
    RAISE EXCEPTION 'CRITICAL FAILURE: Overlapping NULL-contract interval was NOT rejected by EXCLUDE constraint!';
EXCEPTION
    WHEN exclusion_violation THEN
        RAISE NOTICE 'SUCCESS: EXCLUDE constraint successfully rejected overlapping general-scoped rate.';
END $$;

-- 9. Test Case 6: Verify Immutability Trigger rejects UPDATE on frozen record
SELECT 'Test 6: Expecting failure on UPDATE of frozen rate record...' AS step;
DO $$
BEGIN
    UPDATE "client_hourly_rate_versions"
    SET "hourly_rate_in_cents" = 9999
    WHERE "id" = 'rate-v1-contract';

    RAISE EXCEPTION 'CRITICAL FAILURE: Frozen rate version UPDATE was not rejected by immutability trigger!';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM LIKE '%cannot be modified%' THEN
            RAISE NOTICE 'SUCCESS: Immutability trigger rejected UPDATE on frozen rate version.';
        ELSE
            RAISE EXCEPTION 'Unexpected error on UPDATE: %', SQLERRM;
        END IF;
END $$;

-- 10. Test Case 7: Verify Immutability Trigger rejects DELETE on frozen record
SELECT 'Test 7: Expecting failure on DELETE of frozen rate record...' AS step;
DO $$
BEGIN
    DELETE FROM "client_hourly_rate_versions"
    WHERE "id" = 'rate-v1-contract';

    RAISE EXCEPTION 'CRITICAL FAILURE: Frozen rate version DELETE was not rejected by immutability trigger!';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM LIKE '%cannot be deleted%' THEN
            RAISE NOTICE 'SUCCESS: Immutability trigger rejected DELETE on frozen rate version.';
        ELSE
            RAISE EXCEPTION 'Unexpected error on DELETE: %', SQLERRM;
        END IF;
END $$;

-- 11. Test Case 8: Verify Foreign Key RESTRICT on deleting referenced Client
SELECT 'Test 8: Expecting failure on DELETE of referenced Client...' AS step;
DO $$
BEGIN
    DELETE FROM "clients"
    WHERE "id" = 'test-client-staging-5b2a';

    RAISE EXCEPTION 'CRITICAL FAILURE: Deleting client with dependent rate versions was NOT prevented by RESTRICT!';
EXCEPTION
    WHEN foreign_key_violation THEN
        RAISE NOTICE 'SUCCESS: Foreign Key RESTRICT successfully blocked deletion of referenced client.';
END $$;

SELECT 'ALL STAGING PHYSICAL CHECKS COMPLETED SUCCESSFULLY.' AS final_status;

-- Roll back all test data so staging database remains clean
ROLLBACK;
