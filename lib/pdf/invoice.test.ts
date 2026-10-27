import { describe, it, expect, vi } from "vitest";
import zlib from "zlib";

vi.mock("server-only", () => ({}));

import { generateInvoicePdf, type InvoicePdfData } from "./invoice";
import type { CompanyConfig } from "@/lib/config/company";

function extractTextFromPdf(pdfBytes: Uint8Array | Buffer): string {
  const buf = Buffer.from(pdfBytes);
  let text = buf.toString("latin1");
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(buf.toString("latin1"))) !== null) {
    try {
      const decompressed = zlib.inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
      text += "\n" + decompressed;
      const hexRegex = /<([0-9a-fA-F]+)>/g;
      let hexMatch: RegExpExecArray | null;
      let decodedFromHex = "";
      while ((hexMatch = hexRegex.exec(decompressed)) !== null) {
        decodedFromHex += Buffer.from(hexMatch[1], "hex").toString("latin1");
      }
      text += "\n" + decodedFromHex;
    } catch {
      // skip
    }
  }
  return text;
}

describe("Invoice PDF Generation with Multi-Company Branding", () => {
  const baseInvoiceData: InvoicePdfData = {
    invoiceNumber: "028/2026",
    date: "23.04.2026",
    clientId: "MG",
    clientName: "Residenz Ambiente Bonn",
    billingInfo: "Residenz Ambiente Bonn\nKollegienweg 43\n53121 Bonn",
    clientAddress: "Residenz Ambiente Bonn\nKollegienweg 43\n53121 Bonn",
    periodStart: "01.04.2026",
    periodEnd: "12.04.2026",
    items: [
      { pos: 1, description: "Pflegefachkraft vom 01.- 12.04.2026", hours: "46,50", rate: "52,90", amount: "2.459,85 €" },
      { pos: 2, description: "Samstagszuschlag: 25%", hours: "3,00", rate: "13,23", amount: "39,69 €" },
      { pos: 3, description: "Sonntagszuschlag: 100%", hours: "9,00", rate: "52,90", amount: "476,10 €" }
    ],
    subtotal: "2.975,64 €",
    taxAmount: "565,37 €",
    taxRatePercent: 19,
    total: "3.541,01 €",
    paymentTermsDays: 10
  };

  it("generates RheinLand invoice without RheinAhr slogans and with RheinLand footer", async () => {
    const rheinlandConfig: CompanyConfig = {
      name: "RheinLand Personalmanagement und Fahrdienst GmbH",
      shortName: "RheinLand",
      email: "info@rheinland-gmbh.de",
      phone: "+4922840980920",
      fax: "",
      mobile: "+49 1512 6661733",
      website: "www.rheinland-gmbh.de",
      websiteUrl: "https://www.rheinland-gmbh.de",
      street: "Theaterplatz 1",
      city: "53177 Bonn",
      ceo: "Katharina Schebesta",
      registryCourt: "Amtsgericht Bonn",
      hrb: "HRB 28906",
      taxId: "206/5946/0975",
      vatId: "DE459228538",
      bankName: "Finom Payments B.V.",
      iban: "DE24 1001 8000 0966 6504 98",
      bic: "FNOMDEB2XXX",
      logoUrl: "/branding RheinLand.png",
      iconUrl: "",
      auegNumber: ""
    };

    const pdfBuffer = await generateInvoicePdf(baseInvoiceData, rheinlandConfig);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    expect(pdfBuffer.subarray(0, 4).toString("ascii")).toBe("%PDF");

    const pdfText = extractTextFromPdf(pdfBuffer);
    // Ensure RheinAhr slogan is completely excluded
    expect(pdfText).not.toContain("INTEGRITÄT");
    expect(pdfText).not.toContain("WÜRDE");
    expect(pdfText).not.toContain("KOMPETENZ");
    expect(pdfText).not.toContain("VERTRAUEN");
    expect(pdfText).toContain("RheinLand Personalmanagement und Fahrdienst GmbH");
  });

  it("generates RheinAhr invoice preserving its original branding and layout", async () => {
    const rheinahrConfig: CompanyConfig = {
      name: "RheinAhr Dienstleistungen GmbH",
      shortName: "RheinAhr",
      email: "info@rheinahr-gmbh.de",
      phone: "+49 2225 999999",
      fax: "",
      mobile: "+49 1512 6661733",
      website: "www.rheinahr-gmbh.de",
      websiteUrl: "https://www.rheinahr-gmbh.de",
      street: "Bonner Str. 12",
      city: "53340 Meckenheim",
      ceo: "Basem Aldanaf",
      registryCourt: "Amtsgericht Bonn",
      hrb: "HRB 24451",
      taxId: "222/5713/3796",
      vatId: "DE324083321",
      bankName: "Kreissparkasse Köln",
      iban: "DE39 3705 0299 0113 4293 22",
      bic: "COKSDE33XXX",
      logoUrl: "/logo.png",
      iconUrl: "",
      auegNumber: "30101/020218/40517"
    };

    const pdfBuffer = await generateInvoicePdf(baseInvoiceData, rheinahrConfig);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    expect(pdfBuffer.subarray(0, 4).toString("ascii")).toBe("%PDF");

    const pdfText = extractTextFromPdf(pdfBuffer);
    // RheinAhr retains its slogan
    expect(pdfText).toContain("INTEGRIT");
  });
});
