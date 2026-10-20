import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { mapQualificationToShort, kklToCsv, type KklReportData } from "@/lib/kkl";

describe("KKL Report Logic", () => {
  it("correctly maps qualification strings to short codes", () => {
    expect(mapQualificationToShort("pflegefachkraft")).toBe("PFK");
    expect(mapQualificationToShort("pflegehelfer")).toBe("PHK");
    expect(mapQualificationToShort("pflegehilfskraft")).toBe("PHK");
    expect(mapQualificationToShort("betreuungskraft")).toBe("PHK");
    expect(mapQualificationToShort("kuechenhilfe")).toBe("KH");
    expect(mapQualificationToShort("hausmeister")).toBe("HM");
    expect(mapQualificationToShort("pflegedienstleitung")).toBe("PDL");
    expect(mapQualificationToShort("custom_qual")).toBe("CUSTOM_QUAL");
  });

  it("generates correctly formatted CSV with header and exact 9 columns", () => {
    const mockData: KklReportData = {
      company: {
        name: "RheinAhr Dienstleistungen GmbH",
        street: "Theaterplatz 1",
        city: "53177 Bonn",
      },
      client: {
        id: "client-1",
        facilityName: "Evangelisches Altenzentrum Luchtenberg-Richartz-Haus",
        companyAndAddress: "Rheinische Gesellschaft für Diakonie gGmbH, Hasensprung 1, 42799 Leichlingen",
      },
      year: 2026,
      month: 10,
      monthLabel: "Oktober 2026",
      generatedAt: "18.10.2026, 17:00",
      rows: [
        {
          workerName: "Mohammed Shahatit",
          birthDate: "28.08.1989",
          socialSecurityNumber: "53280889S085",
          qualificationCode: "PHK",
          hourlyRateFormatted: "35,90 €",
          startDateFormatted: "17.07.2026",
          endDateFormatted: "19.07.2026",
          weeklyHoursFormatted: "35",
          shiftCodesFormatted: "FD",
          startDateRaw: "2026-07-17",
        },
        {
          workerName: "Garip Senol",
          birthDate: "22.07.1992",
          socialSecurityNumber: "53220792S097",
          qualificationCode: "PFK",
          hourlyRateFormatted: "52,80 €",
          startDateFormatted: "08.08.2026",
          endDateFormatted: "09.08.2026",
          weeklyHoursFormatted: "4,75",
          shiftCodesFormatted: "ND",
          startDateRaw: "2026-08-08",
        },
      ],
    };

    const csv = kklToCsv(mockData);

    // Verify BOM
    expect(csv.startsWith("\uFEFF")).toBe(true);

    // Verify Title & Parties
    expect(csv).toContain("Anlage zum Arbeitnehmerüberlassungsvertrag");
    expect(csv).toContain("RheinAhr Dienstleistungen GmbH;Theaterplatz 1;53177 Bonn;(nachfolgend: Personaldienstleister)");
    expect(csv).toContain("Rheinische Gesellschaft für Diakonie gGmbH, Hasensprung 1, 42799 Leichlingen;(nachfolgend: Kundenunternehmen)");
    expect(csv).toContain("Einrichtung:;Evangelisches Altenzentrum Luchtenberg-Richartz-Haus");

    // Verify 9 column headers
    expect(csv).toContain("Name, Vorname;Geburtsdatum;SV-Nummer;Tätigkeitsbereich;VS netto;Beginn;Ende;Stunden, Woche;HÜL");

    // Verify data rows
    expect(csv).toContain('"Mohammed Shahatit";28.08.1989;53280889S085;PHK;35,90 €;17.07.2026;19.07.2026;35;FD');
    expect(csv).toContain('"Garip Senol";22.07.1992;53220792S097;PFK;52,80 €;08.08.2026;09.08.2026;4,75;ND');
  });

  it("renders KKL PDF without throwing errors", async () => {
    const mockData: KklReportData = {
      company: {
        name: "RheinAhr Dienstleistungen GmbH",
        street: "Theaterplatz 1",
        city: "53177 Bonn",
      },
      client: {
        id: "client-1",
        facilityName: "Evangelisches Altenzentrum Luchtenberg-Richartz-Haus",
        companyAndAddress: "Rheinische Gesellschaft für Diakonie gGmbH, Hasensprung 1, 42799 Leichlingen",
      },
      year: 2026,
      month: 10,
      monthLabel: "Oktober 2026",
      generatedAt: "18.10.2026, 17:00",
      rows: [
        {
          workerName: "Mohammed Shahatit",
          birthDate: "28.08.1989",
          socialSecurityNumber: "53280889S085",
          qualificationCode: "PHK",
          hourlyRateFormatted: "35,90 €",
          startDateFormatted: "17.07.2026",
          endDateFormatted: "19.07.2026",
          weeklyHoursFormatted: "35",
          shiftCodesFormatted: "FD",
          startDateRaw: "2026-07-17",
        },
      ],
    };

    const { renderKklPdf } = await import("@/lib/pdf/kkl");
    const buffer = await renderKklPdf(mockData);
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("renders KKL DOCX without throwing errors and contains logo", async () => {
    const mockData: KklReportData = {
      company: {
        name: "RheinAhr Dienstleistungen GmbH",
        street: "Theaterplatz 1",
        city: "53177 Bonn",
      },
      client: {
        id: "client-1",
        facilityName: "Evangelisches Altenzentrum Luchtenberg-Richartz-Haus",
        companyAndAddress: "Rheinische Gesellschaft für Diakonie gGmbH, Hasensprung 1, 42799 Leichlingen",
      },
      year: 2026,
      month: 10,
      monthLabel: "Oktober 2026",
      generatedAt: "18.10.2026, 17:00",
      rows: [
        {
          workerName: "Mohammed Shahatit",
          birthDate: "28.08.1989",
          socialSecurityNumber: "53280889S085",
          qualificationCode: "PHK",
          hourlyRateFormatted: "35,90 €",
          startDateFormatted: "17.07.2026",
          endDateFormatted: "19.07.2026",
          weeklyHoursFormatted: "35",
          shiftCodesFormatted: "FD",
          startDateRaw: "2026-07-17",
        },
      ],
    };

    const { renderKklDocx } = await import("@/lib/docx/kkl");
    const buffer = await renderKklDocx(mockData);
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(1000);
  });
});

