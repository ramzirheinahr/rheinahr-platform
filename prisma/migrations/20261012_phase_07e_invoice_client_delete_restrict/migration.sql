-- Phase 07e: Alter foreign key constraint on invoices.client_id to ON DELETE RESTRICT
-- RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization (Phase 07e Data Integrity)
--
-- Objective:
-- Permanently prevent PostgreSQL cascade deletion of invoices when a client record is deleted.
-- Ensures strict compliance with GoBD and § 147 AO / § 257 HGB statutory 10-year retention.
--
-- Operational & Locking Characteristics:
-- 1. Alters foreign key constraint on 'invoices' referencing 'clients'('id').
-- 2. Requires ACCESS EXCLUSIVE lock on 'invoices' and SHARE ROW EXCLUSIVE lock on 'clients'
--    during constraint recreation. Must be executed during a planned maintenance window
--    or after traffic pause.
-- 3. Backward Compatibility: 100% backward compatible with application logic, as normal
--    business flows do not rely on physical cascading deletion of invoices.

-- Keep the old foreign key in place if adding its replacement fails or the
-- deployment is interrupted. PostgreSQL rolls back both DDL statements.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Drop pre-existing foreign key constraint if it exists (which had ON DELETE CASCADE)
ALTER TABLE "invoices"
DROP CONSTRAINT IF EXISTS "invoices_client_id_fkey";

-- 2. Re-create foreign key constraint with ON DELETE RESTRICT and ON UPDATE CASCADE
ALTER TABLE "invoices"
ADD CONSTRAINT "invoices_client_id_fkey"
FOREIGN KEY ("client_id")
REFERENCES "clients"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

COMMIT;
