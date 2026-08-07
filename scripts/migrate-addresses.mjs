import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseAddress(addressStr) {
  if (!addressStr) return null;
  // Common format: "Street 123, 12345 City"
  const parts = addressStr.split(",");
  let street = "";
  let houseNumber = "";
  let zip = "";
  let city = "";

  if (parts.length >= 2) {
    const streetPart = parts[0].trim();
    // match last number/alphanumeric part of the street string as house number
    const match = streetPart.match(/^(.*?)\s+([0-9]+[a-zA-Z\-0-9]*)$/);
    if (match) {
      street = match[1].trim();
      houseNumber = match[2].trim();
    } else {
      street = streetPart;
    }

    const zipCityPart = parts[1].trim();
    // match zip code (usually 5 digits in Germany) and city
    const zipCityMatch = zipCityPart.match(/^([0-9]{4,5})\s+(.*)$/);
    if (zipCityMatch) {
      zip = zipCityMatch[1].trim();
      city = zipCityMatch[2].trim();
    } else {
      city = zipCityPart;
    }
  } else {
    // No comma, just try to extract zip and city if possible
    street = addressStr;
  }

  return { street, houseNumber, zip, city };
}

async function migrateAddresses() {
  console.log("Migrating Client addresses...");
  const clients = await prisma.client.findMany({
    where: { address: { not: null }, addressStreet: null },
  });

  for (const client of clients) {
    if (!client.address) continue;
    const parsed = parseAddress(client.address);
    if (parsed) {
      await prisma.client.update({
        where: { id: client.id },
        data: {
          addressStreet: parsed.street || undefined,
          addressHouseNumber: parsed.houseNumber || undefined,
          addressZip: parsed.zip || undefined,
          addressCity: parsed.city || undefined,
        },
      });
      console.log(`Updated client ${client.facilityName}: ${client.address} ->`, parsed);
    }
  }

  console.log("Migrating Worker addresses...");
  const workers = await prisma.worker.findMany({
    where: { address: { not: null }, addressStreet: null },
  });

  for (const worker of workers) {
    if (!worker.address) continue;
    const parsed = parseAddress(worker.address);
    if (parsed) {
      await prisma.worker.update({
        where: { id: worker.id },
        data: {
          addressStreet: parsed.street || undefined,
          addressHouseNumber: parsed.houseNumber || undefined,
          addressZip: parsed.zip || undefined,
          addressCity: parsed.city || undefined,
        },
      });
      console.log(`Updated worker ${worker.fullName}: ${worker.address} ->`, parsed);
    }
  }

  console.log("Done.");
}

migrateAddresses()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
