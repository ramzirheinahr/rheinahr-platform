const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const worker = await prisma.worker.findFirst({ where: { fullName: { contains: "Dempewolff" } } });
  const client = await prisma.client.findFirst({ where: { facilityName: { contains: "Stella Vitalis" } } });
  
  console.log("Worker:", worker?.fullName, worker?.address, "TravelEnabled:", worker?.travelAllowanceEnabled);
  console.log("Client:", client?.facilityName, client?.address);
}
main().finally(() => prisma.$disconnect());
