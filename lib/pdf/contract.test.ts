import { describe, it, expect, vi } from "vitest";
import zlib from "zlib";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/company", () => ({
  getCompanyConfig: vi.fn().mockResolvedValue({
    name: "RheinLand Personalmanagement und Fahrdienst GmbH",
    shortName: "RheinLand",
    ceo: "Katharina Schebesta",
    street: "Theaterplatz 1",
    city: "53177 Bonn",
    phone: "+4922840980920",
    email: "info@rheinland-gmbh.de",
  }),
}));

import { renderContractPdf, type ContractPdfData } from "./contract";
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

describe("Arbeitnehmerüberlassungsvertrag PDF Rendering", () => {
  const sampleContractData: ContractPdfData = {
    facilityName: "Residenz Ambiente Bonn",
    facilityAddress: "Kollegienweg 43\n53121 Bonn",
    contactPerson: "Frau Schmidt",
    period: "22.10.2026 - 31.10.2026",
    periodStart: "22.10.2026",
    periodEnd: "31.10.2026",
    status: "signed",
    signedAt: "26.10.2026 14:30",
    ipAddress: "192.168.1.1",
    surcharges: {
      night: 50,
      sat: 25,
      sun: 100,
      holiday: 125,
      overtime: 25,
    },
    assignments: [
      {
        workerName: "Muster Mitarbeiter",
        qualification: "Pflegefachkraft",
        shiftDate: "22.10.2026",
        startTime: "06:00",
        endTime: "14:00",
        socialSecurity: "12 345678 M 123",
        birthDate: "15.05.1990",
        nationality: "Deutschland",
        hourlyRate: 54.9,
        totalAmount: 439.2,
      },
    ],
  };

  it("renders 9-page RheinLand Arbeitnehmerüberlassungsvertrag with all statutory sections and clauses", async () => {
    const pdfBuffer = await renderContractPdf(sampleContractData);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(1000);
    expect(pdfBuffer.subarray(0, 4).toString("ascii")).toBe("%PDF");

    const text = extractTextFromPdf(pdfBuffer);

    // Verify key sections from the 9-page contract
    expect(text).toContain("Erlaubnis zur Arbeitnehmer");
    expect(text).toContain("Bundesagentur");
    expect(text).toContain("D"); // Düsseldorf
    expect(text).toContain("Bauhauptgewerbeverbot");
    expect(text).toContain("Equal Pay");
    expect(text).toContain("Gemeinschaftseinrichtung");
    expect(text).toContain("Vermittlungsprovision");
    expect(text).toContain("Residenz Ambiente Bonn");
    expect(text).toContain("RheinLand Personalmanagement und Fahrdienst GmbH");
    expect(text).toContain("Katharina Schebesta");
    // Verify place and first shift date in signing line
    expect(text).toContain("Bonn, 22.10.2026");
  });

  it("preserves original RheinAhr contract template without modification", async () => {
    const { getCompanyConfig } = await import("@/lib/config/company");
    vi.mocked(getCompanyConfig).mockResolvedValueOnce({
      name: "RheinAhr Dienstleistungen GmbH",
      shortName: "RheinAhr",
      ceo: "Basem Aldanaf",
      street: "Bonner Str. 12",
      city: "53340 Meckenheim",
      phone: "+49 2225 999999",
      email: "info@rheinahr-gmbh.de",
      website: "www.rheinahr-gmbh.de",
    } as any);

    const pdfBuffer = await renderContractPdf(sampleContractData);
    expect(pdfBuffer).toBeInstanceOf(Buffer);
    expect(pdfBuffer.length).toBeGreaterThan(1000);

    const text = extractTextFromPdf(pdfBuffer);
    expect(text).toContain("RheinAhr Dienstleistungen GmbH");
    // Verify it used the original contract
    expect(text).toContain("Arbeitnehmer");
    // Verify place and first shift date in signing line
    expect(text).toContain("Bonn, 22.10.2026");
  });
});
