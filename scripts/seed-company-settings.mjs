import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const settings = {
  "company.name": "RheinLand Personalmanagement und Fahrdienst GmbH",
  "company.shortName": "RheinLand",
  "company.email": "info@rheinland-gmbh.de",
  "company.phone": "+49 000 000000",
  "company.fax": "+49 000 000000",
  "company.mobile": "+49 1512 6661733",
  "company.website": "www.rheinland-gmbh.de",
  "company.websiteUrl": "https://www.rheinland-gmbh.de",
  "company.street": "Theaterplatz 1",
  "company.city": "53177 Bonn",
  "company.ceo": "Basem Aldanaf",
  "company.registryCourt": "Amtsgericht Bonn",
  "company.hrb": "HRB 00000",
  "company.taxId": "206/5946/0975",
  "company.vatId": "DE459228538",
  "company.bankName": "Finom Payments B.V.",
  "company.iban": "DE24 1001 8000 0966 6504 98",
  "company.bic": "FNOMDEB2XXX",
  "company.logoUrl": "/RheinLand Logo.png",
};

async function main() {
  console.log("Seeding company settings into the database...");
  for (const [key, value] of Object.entries(settings)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    console.log(`✓ ${key}`);
  }
  console.log("Done seeding!");
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
