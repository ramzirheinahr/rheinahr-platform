-- Phase 3a: Additive Migration for Confirmation Evidence Documents and Hours Correction Requests
-- RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization (Phase 3a)
-- Enforces ON DELETE RESTRICT to protect audit documents and unique compound index for concurrency deduplication

-- CreateEnum
CREATE TYPE "ConfirmationDocumentSourceType" AS ENUM ('electronic_original', 'manual_upload', 'manual_correction');

-- CreateEnum
CREATE TYPE "HoursCorrectionStatus" AS ENUM ('proposed', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "confirmation_documents" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "source_type" "ConfirmationDocumentSourceType" NOT NULL,
    "storage_path" TEXT,
    "file_hash" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "file_size_bytes" INTEGER,
    "signature_data" TEXT,
    "signer_name" TEXT,
    "signer_ip" TEXT,
    "uploaded_by_id" TEXT,
    "uploader_role" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "confirmation_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_hours_correction_requests" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "document_id" TEXT,
    "status" "HoursCorrectionStatus" NOT NULL DEFAULT 'proposed',
    "previous_hours_worked" DECIMAL(5,2),
    "proposed_hours_worked" DECIMAL(5,2) NOT NULL,
    "proposed_start_time" TEXT,
    "proposed_end_time" TEXT,
    "proposed_break_minutes" INTEGER,
    "reason" TEXT,
    "requested_by_id" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,

    CONSTRAINT "work_hours_correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "confirmation_documents_assignment_id_file_hash_key" ON "confirmation_documents"("assignment_id", "file_hash");

-- CreateIndex
CREATE INDEX "confirmation_documents_assignment_id_created_at_idx" ON "confirmation_documents"("assignment_id", "created_at");

-- CreateIndex
CREATE INDEX "confirmation_documents_file_hash_idx" ON "confirmation_documents"("file_hash");

-- CreateIndex
CREATE INDEX "work_hours_correction_requests_assignment_id_status_idx" ON "work_hours_correction_requests"("assignment_id", "status");

-- AddForeignKey
ALTER TABLE "confirmation_documents" ADD CONSTRAINT "confirmation_documents_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmation_documents" ADD CONSTRAINT "confirmation_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_hours_correction_requests" ADD CONSTRAINT "work_hours_correction_requests_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_hours_correction_requests" ADD CONSTRAINT "work_hours_correction_requests_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "confirmation_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_hours_correction_requests" ADD CONSTRAINT "work_hours_correction_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_hours_correction_requests" ADD CONSTRAINT "work_hours_correction_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "consumed_confirmation_tickets" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "consumed_by" TEXT NOT NULL,
    "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumed_confirmation_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consumed_confirmation_tickets_ticket_id_key" ON "consumed_confirmation_tickets"("ticket_id");

-- CreateIndex
CREATE INDEX "consumed_confirmation_tickets_storage_path_idx" ON "consumed_confirmation_tickets"("storage_path");
