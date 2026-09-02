import { prisma } from "@/lib/prisma";

export type CompanyConfig = {
  name: string;
  shortName: string;
  email: string;
  phone: string;
  fax: string;
  mobile: string;
  website: string;
  websiteUrl: string;
  street: string;
  city: string;
  ceo: string;
  registryCourt: string;
  hrb: string;
  taxId: string;
  vatId: string;
  bankName: string;
  iban: string;
  bic: string;
  logoUrl: string;
  iconUrl: string;
};

// Fallbacks are read from env during build or if DB is empty.
const FALLBACK: CompanyConfig = {
  name: process.env.NEXT_PUBLIC_COMPANY_NAME || "RheinAhr Dienstleistungen GmbH",
  shortName: process.env.NEXT_PUBLIC_COMPANY_SHORT_NAME || "RheinAhr",
  email: process.env.NEXT_PUBLIC_COMPANY_EMAIL || "info@rheinahr-gmbh.de",
  phone: process.env.NEXT_PUBLIC_COMPANY_PHONE || "+49 2225 999999",
  fax: process.env.NEXT_PUBLIC_COMPANY_FAX || "+49 2225 999999",
  mobile: process.env.NEXT_PUBLIC_COMPANY_MOBILE || "+49 1512 6661733",
  website: process.env.NEXT_PUBLIC_COMPANY_WEBSITE || "www.rheinahr-gmbh.de",
  websiteUrl: process.env.NEXT_PUBLIC_COMPANY_WEBSITE_URL || "https://www.rheinahr-gmbh.de",
  street: process.env.NEXT_PUBLIC_COMPANY_ADDRESS_STREET || "Bonner Str. 12",
  city: process.env.NEXT_PUBLIC_COMPANY_ADDRESS_CITY || "53340 Meckenheim",
  ceo: process.env.NEXT_PUBLIC_COMPANY_CEO || "Basem Aldanaf",
  registryCourt: process.env.NEXT_PUBLIC_COMPANY_REGISTRY_COURT || "Amtsgericht Bonn",
  hrb: process.env.NEXT_PUBLIC_COMPANY_HRB || "HRB 24451",
  taxId: process.env.NEXT_PUBLIC_COMPANY_TAX_ID || "222/5713/3796",
  vatId: process.env.NEXT_PUBLIC_COMPANY_VAT_ID || "DE324083321",
  bankName: process.env.NEXT_PUBLIC_COMPANY_BANK_NAME || "Kreissparkasse Köln",
  iban: process.env.NEXT_PUBLIC_COMPANY_IBAN || "DE39 3705 0299 0113 4293 22",
  bic: process.env.NEXT_PUBLIC_COMPANY_BIC || "COKSDE33XXX",
  logoUrl: process.env.NEXT_PUBLIC_COMPANY_LOGO_URL || "/logo.png",
  iconUrl: process.env.NEXT_PUBLIC_COMPANY_ICON_URL || "/rheinahr-icon-192.png",
};

export async function getCompanyConfig(): Promise<CompanyConfig> {
  try {
    const settings = await prisma.systemSetting.findMany({
      where: { key: { startsWith: "company." } }
    });
    
    if (!settings.length) return FALLBACK;
    
    const dbConf = settings.reduce((acc, s) => {
      acc[s.key] = s.value;
      return acc;
    }, {} as Record<string, string>);

    return {
      name: dbConf["company.name"] || FALLBACK.name,
      shortName: dbConf["company.shortName"] || FALLBACK.shortName,
      email: dbConf["company.email"] || FALLBACK.email,
      phone: dbConf["company.phone"] || FALLBACK.phone,
      fax: dbConf["company.fax"] || FALLBACK.fax,
      mobile: dbConf["company.mobile"] || FALLBACK.mobile,
      website: dbConf["company.website"] || FALLBACK.website,
      websiteUrl: dbConf["company.websiteUrl"] || FALLBACK.websiteUrl,
      street: dbConf["company.street"] || FALLBACK.street,
      city: dbConf["company.city"] || FALLBACK.city,
      ceo: dbConf["company.ceo"] || FALLBACK.ceo,
      registryCourt: dbConf["company.registryCourt"] || FALLBACK.registryCourt,
      hrb: dbConf["company.hrb"] || FALLBACK.hrb,
      taxId: dbConf["company.taxId"] || FALLBACK.taxId,
      vatId: dbConf["company.vatId"] || FALLBACK.vatId,
      bankName: dbConf["company.bankName"] || FALLBACK.bankName,
      iban: dbConf["company.iban"] || FALLBACK.iban,
      bic: dbConf["company.bic"] || FALLBACK.bic,
      logoUrl: dbConf["company.logoUrl"] || FALLBACK.logoUrl,
      iconUrl: dbConf["company.iconUrl"] || FALLBACK.iconUrl,
    };
  } catch (e) {
    return FALLBACK;
  }
}
