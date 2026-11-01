-- AlterTable
ALTER TABLE "workers"
  ADD COLUMN "travel_allowance_valid_from" DATE,
  ADD COLUMN "travel_allowance_valid_until" DATE;

-- AlterTable
ALTER TABLE "assignments"
  ADD COLUMN "add_travel_allowance" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_swap" BOOLEAN NOT NULL DEFAULT false;
