-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AdjustmentType" AS ENUM ('k_ausgleich', 'sonstige', 'urlaub', 'krank');

-- CreateEnum
CREATE TYPE "public"."AppointmentStatus" AS ENUM ('scheduled', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."AssignmentStatus" AS ENUM ('pending', 'confirmed', 'declined');

-- CreateEnum
CREATE TYPE "public"."AvailabilityStatus" AS ENUM ('available', 'unavailable', 'assigned');

-- CreateEnum
CREATE TYPE "public"."ConfirmationMethod" AS ENUM ('electronic', 'upload');

-- CreateEnum
CREATE TYPE "public"."ContractStatus" AS ENUM ('pending', 'signed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."ContractType" AS ENUM ('unbefristet', 'befristet');

-- CreateEnum
CREATE TYPE "public"."DocumentCategory" AS ENUM ('certification', 'id_document', 'vaccination', 'contract', 'service_confirmation', 'other');

-- CreateEnum
CREATE TYPE "public"."EmailStatus" AS ENUM ('sent', 'failed', 'skipped_preference');

-- CreateEnum
CREATE TYPE "public"."EmploymentType" AS ENUM ('vollzeit', 'teilzeit', 'minijob', 'werkstudent');

-- CreateEnum
CREATE TYPE "public"."InvoiceStatus" AS ENUM ('unpaid', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."Language" AS ENUM ('de', 'en', 'ar');

-- CreateEnum
CREATE TYPE "public"."LeaveStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "public"."LeaveType" AS ENUM ('vacation', 'sick', 'other');

-- CreateEnum
CREATE TYPE "public"."NotificationChannel" AS ENUM ('email', 'sms', 'in_app');

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('new_order', 'worker_assigned', 'worker_confirmed', 'reminder_24h', 'reminder_1h', 'service_confirmed', 'order_status_changed', 'document_uploaded', 'new_message', 'contract_pending', 'contract_signed');

-- CreateEnum
CREATE TYPE "public"."OrderStatus" AS ENUM ('pending', 'review', 'availability_check', 'assigned', 'accepted', 'in_progress', 'completed', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."OwnerType" AS ENUM ('worker', 'client');

-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('admin', 'client', 'worker', 'super_admin');

-- CreateTable
CREATE TABLE "public"."appointments" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "location" TEXT,
    "status" "public"."AppointmentStatus" NOT NULL DEFAULT 'scheduled',
    "manager_id" TEXT NOT NULL,
    "client_id" TEXT,
    "worker_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."assignments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "status" "public"."AssignmentStatus" NOT NULL DEFAULT 'pending',
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "cancel_note" TEXT,
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "cancel_requested_at" TIMESTAMP(3),
    "contract_id" TEXT,
    "invoice_id" TEXT,
    "add_meal_allowance" BOOLEAN NOT NULL DEFAULT false,
    "bonus_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "exclude_meal_allowance" BOOLEAN NOT NULL DEFAULT false,
    "exclude_travel_allowance" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entity_id" TEXT,
    "ip_address" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."client_contracts" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "status" "public"."ContractStatus" NOT NULL DEFAULT 'pending',
    "period" TEXT,
    "signature_data" TEXT,
    "document_url" TEXT,
    "signed_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "split_by_shift" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "client_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."clients" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "facility_name" TEXT NOT NULL,
    "facility_type" TEXT NOT NULL,
    "address" TEXT,
    "contact_person" TEXT,
    "billing_info" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "surcharge_holiday" DOUBLE PRECISION,
    "surcharge_sat" DOUBLE PRECISION,
    "surcharge_sun" DOUBLE PRECISION,
    "short_code" TEXT,
    "hourly_rates" JSONB,
    "night_end" TEXT,
    "night_start" TEXT,
    "surcharge_night" DOUBLE PRECISION,
    "framework_agreement_signed_at" TIMESTAMP(3),
    "framework_agreement_url" TEXT,
    "internal_number" TEXT,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 14,
    "billing_email" TEXT,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversation_participants" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3),

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversations" (
    "id" TEXT NOT NULL,
    "subject" TEXT,
    "assignment_id" TEXT,
    "request_group_id" TEXT,
    "created_by" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leave_request_id" TEXT,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."documents" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "owner_type" "public"."OwnerType" NOT NULL,
    "category" "public"."DocumentCategory" NOT NULL,
    "file_url" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invoices" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "status" "public"."InvoiceStatus" NOT NULL DEFAULT 'unpaid',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "net_amount" DOUBLE PRECISION NOT NULL,
    "vat_amount" DOUBLE PRECISION NOT NULL,
    "gross_amount" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "snapshot_data" JSONB,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."leave_days" (
    "id" TEXT NOT NULL,
    "leave_request_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 7.0,
    "status" "public"."LeaveStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "leave_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."leave_requests" (
    "id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "status" "public"."LeaveStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "type" "public"."LeaveType" NOT NULL DEFAULT 'vacation',

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."messages" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT,
    "sender_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversation_id" TEXT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "public"."NotificationType" NOT NULL,
    "channel" "public"."NotificationChannel" NOT NULL,
    "content" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "link" TEXT,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."orders" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "required_qualification" TEXT NOT NULL,
    "shift_date" DATE NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "public"."OrderStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "request_group_id" TEXT,
    "break_minutes" INTEGER NOT NULL DEFAULT 30,
    "created_by" TEXT,
    "edited_at" TIMESTAMP(3),
    "edited_by" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."outgoing_emails" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "recipient_name" TEXT,
    "user_id" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "html" TEXT,
    "status" "public"."EmailStatus" NOT NULL DEFAULT 'sent',
    "error" TEXT,
    "attachments" JSONB,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outgoing_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."service_confirmations" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "confirmed_by" TEXT,
    "method" "public"."ConfirmationMethod" NOT NULL,
    "signature_data" TEXT,
    "document_url" TEXT,
    "hours_worked" DECIMAL(5,2),
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "client_notes" TEXT,
    "correction_hours" DECIMAL(5,2),
    "correction_note" TEXT,
    "correction_requested_at" TIMESTAMP(3),
    "correction_requested_by" TEXT,
    "requested_end" TEXT,
    "requested_start" TEXT,
    "signer_name" TEXT,

    CONSTRAINT "service_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "device" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL,
    "preferred_language" "public"."Language" NOT NULL DEFAULT 'de',
    "2fa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "full_name" TEXT,
    "login_pin_attempts" INTEGER NOT NULL DEFAULT 0,
    "login_pin_hash" TEXT,
    "login_pin_lock_until" TIMESTAMP(3),
    "login_token" TEXT,
    "receive_emails" BOOLEAN NOT NULL DEFAULT true,
    "client_id" TEXT,
    "job_title" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "password_reset_expires" TIMESTAMP(3),
    "password_reset_token" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."worker_availability" (
    "id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "public"."AvailabilityStatus" NOT NULL DEFAULT 'unavailable',
    "notes" TEXT,
    "end_time" TEXT,
    "start_time" TEXT,

    CONSTRAINT "worker_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."worker_documents" (
    "id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "category" "public"."DocumentCategory" NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."worker_hours_adjustments" (
    "id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "type" "public"."AdjustmentType" NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_hours_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."worker_soll_hours" (
    "id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "valid_from" TEXT NOT NULL,
    "weekly_hours" DOUBLE PRECISION NOT NULL,
    "monthly_hours" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_soll_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "qualification" TEXT NOT NULL,
    "certifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contract_type" "public"."ContractType" NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "bio" TEXT,
    "birth_date" DATE,
    "birth_place" TEXT,
    "employed_since" DATE,
    "nationality" TEXT,
    "photo_path" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "social_security_number" TEXT,
    "years_experience" INTEGER,
    "required_hours" DOUBLE PRECISION NOT NULL DEFAULT 151.67,
    "carryover_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "arbeitsvertrag_signed_at" TIMESTAMP(3),
    "arbeitsvertrag_url" TEXT,
    "employment_end_date" DATE,
    "employment_start_date" DATE,
    "hourly_rates" JSONB,
    "meal_allowance" DOUBLE PRECISION DEFAULT 14.0,
    "night_end" TEXT,
    "night_start" TEXT,
    "surcharge_holiday" DOUBLE PRECISION,
    "surcharge_night" DOUBLE PRECISION,
    "surcharge_sat" DOUBLE PRECISION,
    "surcharge_sun" DOUBLE PRECISION,
    "travel_allowance_enabled" BOOLEAN NOT NULL DEFAULT false,
    "travel_allowance_per_km" DOUBLE PRECISION,
    "internal_number" TEXT,
    "entgeltgruppe" TEXT,
    "monthly_salary" DOUBLE PRECISION,
    "weekly_hours" DOUBLE PRECISION,
    "employment_type" "public"."EmploymentType" NOT NULL DEFAULT 'vollzeit',
    "deployment_radius" INTEGER NOT NULL DEFAULT 100,
    "meal_allowance_type" TEXT NOT NULL DEFAULT 'multiple_shifts_only',

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_manager_id_date_idx" ON "public"."appointments"("manager_id" ASC, "date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "assignments_order_id_worker_id_key" ON "public"."assignments"("order_id" ASC, "worker_id" ASC);

-- CreateIndex
CREATE INDEX "assignments_worker_id_status_idx" ON "public"."assignments"("worker_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "public"."audit_logs"("entity" ASC, "entity_id" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "public"."audit_logs"("user_id" ASC);

-- CreateIndex
CREATE INDEX "client_contracts_client_id_status_idx" ON "public"."client_contracts"("client_id" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "clients_short_code_key" ON "public"."clients"("short_code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "clients_user_id_key" ON "public"."clients"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_conversation_id_user_id_key" ON "public"."conversation_participants"("conversation_id" ASC, "user_id" ASC);

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_idx" ON "public"."conversation_participants"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_assignment_id_key" ON "public"."conversations"("assignment_id" ASC);

-- CreateIndex
CREATE INDEX "conversations_last_message_at_idx" ON "public"."conversations"("last_message_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_leave_request_id_key" ON "public"."conversations"("leave_request_id" ASC);

-- CreateIndex
CREATE INDEX "conversations_request_group_id_idx" ON "public"."conversations"("request_group_id" ASC);

-- CreateIndex
CREATE INDEX "documents_owner_id_owner_type_idx" ON "public"."documents"("owner_id" ASC, "owner_type" ASC);

-- CreateIndex
CREATE INDEX "invoices_client_id_status_idx" ON "public"."invoices"("client_id" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "public"."invoices"("invoice_number" ASC);

-- CreateIndex
CREATE INDEX "leave_days_date_status_idx" ON "public"."leave_days"("date" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "leave_days_leave_request_id_date_key" ON "public"."leave_days"("leave_request_id" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "leave_requests_worker_id_status_idx" ON "public"."leave_requests"("worker_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "messages_assignment_id_created_at_idx" ON "public"."messages"("assignment_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "public"."messages"("conversation_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "public"."notifications"("user_id" ASC, "read_at" ASC);

-- CreateIndex
CREATE INDEX "orders_client_id_request_group_id_idx" ON "public"."orders"("client_id" ASC, "request_group_id" ASC);

-- CreateIndex
CREATE INDEX "orders_request_group_id_idx" ON "public"."orders"("request_group_id" ASC);

-- CreateIndex
CREATE INDEX "orders_shift_date_idx" ON "public"."orders"("shift_date" ASC);

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "public"."orders"("status" ASC);

-- CreateIndex
CREATE INDEX "outgoing_emails_created_at_idx" ON "public"."outgoing_emails"("created_at" ASC);

-- CreateIndex
CREATE INDEX "outgoing_emails_status_idx" ON "public"."outgoing_emails"("status" ASC);

-- CreateIndex
CREATE INDEX "outgoing_emails_to_idx" ON "public"."outgoing_emails"("to" ASC);

-- CreateIndex
CREATE INDEX "outgoing_emails_user_id_idx" ON "public"."outgoing_emails"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "public"."push_subscriptions"("endpoint" ASC);

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "public"."push_subscriptions"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "service_confirmations_assignment_id_key" ON "public"."service_confirmations"("assignment_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_key" ON "public"."user_sessions"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_login_token_key" ON "public"."users"("login_token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_password_reset_token_key" ON "public"."users"("password_reset_token" ASC);

-- CreateIndex
CREATE INDEX "worker_availability_date_status_idx" ON "public"."worker_availability"("date" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "worker_availability_worker_id_date_idx" ON "public"."worker_availability"("worker_id" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "worker_documents_worker_id_idx" ON "public"."worker_documents"("worker_id" ASC);

-- CreateIndex
CREATE INDEX "worker_hours_adjustments_worker_id_month_idx" ON "public"."worker_hours_adjustments"("worker_id" ASC, "month" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "worker_soll_hours_worker_id_valid_from_key" ON "public"."worker_soll_hours"("worker_id" ASC, "valid_from" ASC);

-- CreateIndex
CREATE INDEX "workers_qualification_idx" ON "public"."workers"("qualification" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "workers_user_id_key" ON "public"."workers"("user_id" ASC);

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."appointments" ADD CONSTRAINT "appointments_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."assignments" ADD CONSTRAINT "assignments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "public"."client_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."assignments" ADD CONSTRAINT "assignments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."assignments" ADD CONSTRAINT "assignments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."assignments" ADD CONSTRAINT "assignments_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."client_contracts" ADD CONSTRAINT "client_contracts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."clients" ADD CONSTRAINT "clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invoices" ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leave_days" ADD CONSTRAINT "leave_days_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leave_requests" ADD CONSTRAINT "leave_requests_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."outgoing_emails" ADD CONSTRAINT "outgoing_emails_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."service_confirmations" ADD CONSTRAINT "service_confirmations_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."service_confirmations" ADD CONSTRAINT "service_confirmations_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."worker_availability" ADD CONSTRAINT "worker_availability_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."worker_documents" ADD CONSTRAINT "worker_documents_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."worker_hours_adjustments" ADD CONSTRAINT "worker_hours_adjustments_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."worker_soll_hours" ADD CONSTRAINT "worker_soll_hours_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workers" ADD CONSTRAINT "workers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
