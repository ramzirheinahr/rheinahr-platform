ALTER TABLE "assignments"
  ADD COLUMN "travel_distance_km" DOUBLE PRECISION,
  ADD COLUMN "travel_rate_per_km" DOUBLE PRECISION,
  ADD COLUMN "travel_cost_cents" INTEGER,
  ADD COLUMN "travel_eligible" BOOLEAN,
  ADD COLUMN "travel_snapshot_at" TIMESTAMP(3),
  ADD COLUMN "travel_origin_address" TEXT,
  ADD COLUMN "travel_destination_address" TEXT,
  ADD COLUMN "travel_snapshot_source" TEXT;
