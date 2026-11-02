-- DropForeignKey
ALTER TABLE "confirmation_documents" DROP CONSTRAINT IF EXISTS "confirmation_documents_assignment_id_fkey";

-- DropForeignKey
ALTER TABLE "work_hours_correction_requests" DROP CONSTRAINT IF EXISTS "work_hours_correction_requests_assignment_id_fkey";

-- DropForeignKey
ALTER TABLE "work_hours_correction_requests" DROP CONSTRAINT IF EXISTS "work_hours_correction_requests_document_id_fkey";

-- AddForeignKey
ALTER TABLE "confirmation_documents" ADD CONSTRAINT "confirmation_documents_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_hours_correction_requests" ADD CONSTRAINT "work_hours_correction_requests_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_hours_correction_requests" ADD CONSTRAINT "work_hours_correction_requests_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "confirmation_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
