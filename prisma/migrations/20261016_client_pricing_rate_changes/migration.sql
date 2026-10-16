-- CreateTable
CREATE TABLE "client_pricing_rate_changes" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "qualification_code" VARCHAR(120) NOT NULL,
    "hourly_rate_in_cents" INTEGER,
    "effective_from" DATE NOT NULL,
    "verified_by_user_id" TEXT NOT NULL,
    "source_reference" TEXT NOT NULL,
    "frozen_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_pricing_rate_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_pricing_rate_changes_client_id_qualification_code_ef_idx" ON "client_pricing_rate_changes"("client_id", "qualification_code", "effective_from", "created_at");

-- AddForeignKey
ALTER TABLE "client_pricing_rate_changes" ADD CONSTRAINT "client_pricing_rate_changes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
