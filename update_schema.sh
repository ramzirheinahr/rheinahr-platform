#!/bin/bash
set -e

# Replace mealAllowanceEnabled and mealAllowanceOnePerDay with mealAllowanceType
sed -i '' 's/mealAllowanceEnabled   Boolean @default(false) @map("meal_allowance_enabled")//g' prisma/schema.prisma
sed -i '' 's/mealAllowanceOnePerDay Boolean @default(true) @map("meal_allowance_one_per_day")//g' prisma/schema.prisma
sed -i '' 's/mealAllowance          Float?  @default(14.0) @map("meal_allowance")/mealAllowanceType      String  @default("multiple_shifts_only") @map("meal_allowance_type")\n  mealAllowance          Float?  @default(14.0) @map("meal_allowance")/g' prisma/schema.prisma

# Fix any empty lines left behind by the removal
sed -i '' '/^$/N;/^\n$/D' prisma/schema.prisma

echo "Running prisma generate..."
npx prisma generate
