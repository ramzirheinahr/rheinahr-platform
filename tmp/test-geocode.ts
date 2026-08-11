import { prisma } from "../lib/prisma";
import { getDrivingDistanceKm } from "../lib/geocoding";
import { buildAddressString } from "../lib/utils";

async function main() {
  const worker = await prisma.worker.findFirst({ where: { fullName: { contains: "Dempewolff" } } });
  const client = await prisma.client.findFirst({ where: { facilityName: { contains: "Stella Vitalis" } } });
  
  if (!worker || !client) {
    console.log("Not found", !!worker, !!client);
    return;
  }
  
  const workerAddr = buildAddressString(worker);
  const clientAddr = buildAddressString(client);
  
  console.log("Worker Address:", workerAddr);
  console.log("Client Address:", clientAddr);
  
  const dist = await getDrivingDistanceKm(workerAddr, clientAddr);
  console.log("Distance:", dist);
}

main().catch(console.error);
