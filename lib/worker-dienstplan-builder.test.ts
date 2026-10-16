import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getShiftTypeInfo,
  formatDateDe,
  getDayOfWeekDe,
} from "./worker-dienstplan-builder";

describe("worker-dienstplan-builder", () => {
  describe("getShiftTypeInfo", () => {
    it("identifies Frühdienst (FD) for typical morning starts", () => {
      const f1 = getShiftTypeInfo("06:00", "14:00");
      expect(f1.shiftCode).toBe("FD");
      expect(f1.shiftLabel).toBe("Frühdienst");

      const f2 = getShiftTypeInfo("06:30", "14:30");
      expect(f2.shiftCode).toBe("FD");
      expect(f2.shiftBadgeBg).toBe("#e0f2fe");
      expect(f2.shiftBadgeText).toBe("#0369a1");

      const f3 = getShiftTypeInfo("07:00", "15:30");
      expect(f3.shiftCode).toBe("FD");
    });

    it("identifies Spätdienst (SD) for afternoon / evening shifts", () => {
      const s1 = getShiftTypeInfo("13:30", "21:00");
      expect(s1.shiftCode).toBe("SD");
      expect(s1.shiftLabel).toBe("Spätdienst");
      expect(s1.shiftBadgeBg).toBe("#ffedd5");
      expect(s1.shiftBadgeText).toBe("#9a3412");

      const s2 = getShiftTypeInfo("14:00", "22:00");
      expect(s2.shiftCode).toBe("SD");

      const s3 = getShiftTypeInfo("12:00", "20:00");
      expect(s3.shiftCode).toBe("SD");
    });

    it("identifies Nachtdienst (ND) for overnight and night starts", () => {
      const n1 = getShiftTypeInfo("20:30", "07:00");
      expect(n1.shiftCode).toBe("ND");
      expect(n1.shiftLabel).toBe("Nachtdienst");
      expect(n1.shiftBadgeBg).toBe("#ede9fe");
      expect(n1.shiftBadgeText).toBe("#5b21b6");

      const n2 = getShiftTypeInfo("21:00", "06:30");
      expect(n2.shiftCode).toBe("ND");

      const n3 = getShiftTypeInfo("22:00", "06:00");
      expect(n3.shiftCode).toBe("ND");

      const n4 = getShiftTypeInfo("01:00", "07:00");
      expect(n4.shiftCode).toBe("ND");
    });

    it("identifies Tagdienst (TD) for full daytime shifts spanning outside standard FD", () => {
      const t1 = getShiftTypeInfo("08:30", "17:30");
      expect(t1.shiftCode).toBe("TD");
      expect(t1.shiftLabel).toBe("Tagdienst");
    });
  });

  describe("formatDateDe", () => {
    it("formats ISO YYYY-MM-DD to DD.MM.YYYY", () => {
      expect(formatDateDe("2026-05-04")).toBe("04.05.2026");
      expect(formatDateDe("2026-12-31")).toBe("31.12.2026");
    });
  });

  describe("getDayOfWeekDe", () => {
    it("identifies weekdays correctly", () => {
      // 2026-05-04 is a Monday
      const mon = getDayOfWeekDe("2026-05-04");
      expect(mon.label).toBe("Mo.");
      expect(mon.isWeekend).toBe(false);

      // 2026-05-08 is Friday
      const fri = getDayOfWeekDe("2026-05-08");
      expect(fri.label).toBe("Fr.");
      expect(fri.isWeekend).toBe(false);
    });

    it("identifies weekends correctly", () => {
      // 2026-05-09 is Saturday
      const sat = getDayOfWeekDe("2026-05-09");
      expect(sat.label).toBe("Sa.");
      expect(sat.isWeekend).toBe(true);

      // 2026-05-10 is Sunday
      const sun = getDayOfWeekDe("2026-05-10");
      expect(sun.label).toBe("So.");
      expect(sun.isWeekend).toBe(true);
    });
  });

  describe("generateWorkerDienstplanPdf", () => {
    it("renders valid PDF buffer for a monthly schedule with shifts and leaves", async () => {
      const { generateWorkerDienstplanPdf } = await import("./pdf/worker-dienstplan");
      const sampleData = {
        worker: {
          id: "worker-1",
          fullName: "Mustermann, Max",
          salutation: "herr",
          internalNumber: "MA-1042",
          qualification: "Pflegefachkraft",
          birthDate: "14.07.1988",
          phone: "+49 170 1234567",
        },
        monthLabel: "Mai 2026",
        year: 2026,
        month: 5,
        generatedAt: "01.05.2026, 08:00 Uhr",
        rows: [
          {
            id: "shift-1",
            date: "2026-05-04",
            dateFormatted: "04.05.2026",
            dayOfWeek: "Mo.",
            isWeekend: false,
            startTime: "06:00",
            endTime: "14:00",
            timeRange: "06:00 – 14:00",
            breakMinutes: 30,
            scheduledHours: 7.5,
            confirmedHours: 7.5,
            shiftCode: "FD" as const,
            shiftLabel: "Frühdienst",
            shiftBadgeBg: "#e0f2fe",
            shiftBadgeText: "#0369a1",
            shiftBadgeBorder: "#7dd3fc",
            facilityName: "Seniorenresidenz Rheinblick",
            address: "Rheinuferstr. 10, 53173 Bonn",
            notes: "Station 2 (Demenzbereich)",
            statusLabel: "Bestätigt",
            isConfirmed: true,
          },
          {
            id: "shift-2",
            date: "2026-05-05",
            dateFormatted: "05.05.2026",
            dayOfWeek: "Di.",
            isWeekend: false,
            startTime: "13:30",
            endTime: "21:00",
            timeRange: "13:30 – 21:00",
            breakMinutes: 30,
            scheduledHours: 7.0,
            confirmedHours: null,
            shiftCode: "SD" as const,
            shiftLabel: "Spätdienst",
            shiftBadgeBg: "#ffedd5",
            shiftBadgeText: "#9a3412",
            shiftBadgeBorder: "#fdba74",
            facilityName: "Seniorenresidenz Rheinblick",
            address: "Rheinuferstr. 10, 53173 Bonn",
            notes: null,
            statusLabel: "Eingeteilt",
            isConfirmed: false,
          },
          {
            id: "shift-3",
            date: "2026-05-09",
            dateFormatted: "09.05.2026",
            dayOfWeek: "Sa.",
            isWeekend: true,
            startTime: "20:30",
            endTime: "07:00",
            timeRange: "20:30 – 07:00",
            breakMinutes: 45,
            scheduledHours: 9.75,
            confirmedHours: null,
            shiftCode: "ND" as const,
            shiftLabel: "Nachtdienst",
            shiftBadgeBg: "#ede9fe",
            shiftBadgeText: "#5b21b6",
            shiftBadgeBorder: "#c4b5fd",
            facilityName: "Altenheim Sankt Martin",
            address: "Martinusstr. 4, 53474 Bad Neuenahr",
            notes: null,
            statusLabel: "Offen",
            isConfirmed: false,
          },
        ],
        leaves: [
          {
            dateFormatted: "15.05.2026",
            typeLabel: "Erholungsurlaub",
            hours: 7.0,
          },
        ],
        totals: {
          totalShifts: 3,
          earlyShiftsCount: 1,
          lateShiftsCount: 1,
          nightShiftsCount: 1,
          dayShiftsCount: 0,
          plannedHours: 24.25,
          confirmedHours: 7.5,
          requiredHours: 151.67,
        },
      };

      const pdfBuffer = await generateWorkerDienstplanPdf(sampleData);
      expect(pdfBuffer).toBeInstanceOf(Buffer);
      expect(pdfBuffer.length).toBeGreaterThan(1000);
      // Verify PDF header magic bytes "%PDF"
      expect(pdfBuffer.slice(0, 4).toString()).toBe("%PDF");
    });
  });
});
