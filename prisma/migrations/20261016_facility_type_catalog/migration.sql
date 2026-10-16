-- CreateTable
CREATE TABLE "facility_type_catalog" (
    "code" VARCHAR(120) NOT NULL,
    "name_de" VARCHAR(120) NOT NULL,
    "name_en" VARCHAR(120) NOT NULL,
    "name_ar" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facility_type_catalog_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "facility_type_catalog_active_sort_order_idx" ON "facility_type_catalog"("active", "sort_order");
