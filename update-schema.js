import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log("Altering columns to text...");
  await prisma.$executeRawUnsafe(`ALTER TABLE clients ALTER COLUMN facility_type TYPE text USING facility_type::text;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE orders ALTER COLUMN required_qualification TYPE text USING required_qualification::text;`);
  await prisma.$executeRawUnsafe(`ALTER TABLE workers ALTER COLUMN qualification TYPE text USING qualification::text;`);
  
  console.log("Dropping old enums...");
  await prisma.$executeRawUnsafe(`DROP TYPE IF EXISTS "FacilityType" CASCADE;`);
  await prisma.$executeRawUnsafe(`DROP TYPE IF EXISTS "Qualification" CASCADE;`);
  
  console.log("Done.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
