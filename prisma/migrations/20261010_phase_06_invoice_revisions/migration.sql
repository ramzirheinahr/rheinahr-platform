-- Phase 6: Immutable Invoice Revision History Model
-- RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization (Phase 6)
--
-- Architectural Guarantees:
-- 1. Provenance Preservation:
--    Historical invoice states, snapshots, and financial figures are permanently recorded
--    before any update is committed.
-- 2. Restrict Deletion Policy:
--    The invoice relation enforces ON DELETE RESTRICT to guarantee that an invoice with
--    revision records cannot be accidentally deleted from the database.
-- 3. Version Uniqueness & Monotonic Ordering:
--    Enforces unique sequential revision_number per invoice_id (invoice_id, revision_number).
-- 4. Database-Level Immutability:
--    An SQL trigger physically prevents any UPDATE or DELETE on invoice_revisions once inserted.

-- CreateTable
CREATE TABLE IF NOT EXISTS "invoice_revisions" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "reason" TEXT,
    "previous_status" "InvoiceStatus" NOT NULL,
    "previous_net_amount" DOUBLE PRECISION NOT NULL,
    "previous_vat_amount" DOUBLE PRECISION NOT NULL,
    "previous_gross_amount" DOUBLE PRECISION NOT NULL,
    "previous_snapshot_data" JSONB,
    "new_net_amount" DOUBLE PRECISION NOT NULL,
    "new_vat_amount" DOUBLE PRECISION NOT NULL,
    "new_gross_amount" DOUBLE PRECISION NOT NULL,
    "new_snapshot_data" JSONB,
    "preview_token" TEXT,

    CONSTRAINT "invoice_revisions_pkey" PRIMARY KEY ("id")
);

-- Indexing
CREATE INDEX IF NOT EXISTS "invoice_revisions_invoice_id_idx" ON "invoice_revisions"("invoice_id");
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_revisions_invoice_id_revision_number_key" ON "invoice_revisions"("invoice_id", "revision_number");

-- Foreign Keys
ALTER TABLE "invoice_revisions"
DROP CONSTRAINT IF EXISTS "invoice_revisions_invoice_id_fkey",
ADD CONSTRAINT "invoice_revisions_invoice_id_fkey"
FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_revisions"
DROP CONSTRAINT IF EXISTS "invoice_revisions_created_by_fkey",
ADD CONSTRAINT "invoice_revisions_created_by_fkey"
FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PostgreSQL Engine-Level Immutability Trigger
CREATE OR REPLACE FUNCTION prevent_invoice_revision_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'InvoiceRevision records are strictly immutable and cannot be modified or deleted (ID: %, Invoice: %).', OLD.id, OLD.invoice_id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_invoice_revision_modification ON "invoice_revisions";
CREATE TRIGGER trg_prevent_invoice_revision_modification
BEFORE UPDATE OR DELETE ON "invoice_revisions"
FOR EACH ROW
EXECUTE FUNCTION prevent_invoice_revision_modification();
