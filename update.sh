#!/bin/bash
set -e

echo "Updating schema.prisma..."
# Add mealAllowanceOnePerDay to schema.prisma
sed -i '' 's/mealAllowance          Float?  @default(14.0) @map("meal_allowance")/mealAllowance          Float?  @default(14.0) @map("meal_allowance")\n  mealAllowanceOnePerDay Boolean @default(true) @map("meal_allowance_one_per_day")/' prisma/schema.prisma

echo "Running prisma generate..."
npx prisma generate

