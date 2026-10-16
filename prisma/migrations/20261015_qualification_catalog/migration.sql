-- CreateTable
CREATE TABLE "qualification_catalog" (
    "code" VARCHAR(120) NOT NULL,
    "name_de" VARCHAR(120) NOT NULL,
    "name_en" VARCHAR(120) NOT NULL,
    "name_ar" VARCHAR(120) NOT NULL,
    "default_client_rate_cents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qualification_catalog_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "qualification_default_rate_versions" (
    "id" TEXT NOT NULL,
    "qualification_code" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL,
    "hourly_rate_in_cents" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "source_reference" TEXT NOT NULL,
    "verified_by_user_id" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozen_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qualification_default_rate_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qualification_catalog_active_sort_order_idx" ON "qualification_catalog"("active", "sort_order");

-- CreateIndex
CREATE INDEX "qualification_default_rate_versions_qualification_code_effe_idx" ON "qualification_default_rate_versions"("qualification_code", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "qualification_default_rate_versions_qualification_code_vers_key" ON "qualification_default_rate_versions"("qualification_code", "version");

-- AddForeignKey
ALTER TABLE "qualification_default_rate_versions" ADD CONSTRAINT "qualification_default_rate_versions_qualification_code_fkey" FOREIGN KEY ("qualification_code") REFERENCES "qualification_catalog"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
