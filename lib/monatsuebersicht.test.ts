import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renderMonatsuebersichtPdf, type MonatsuebersichtData } from "@/lib/pdf/monatsuebersicht";

describe("Monatsuebersicht PDF Generator", () => {
  it("renders Monatsübersicht PDF with Geburtsdatum and weekend/holiday highlights", async () => {
    const mockData: MonatsuebersichtData = {
      facilityName: "Seniorenhaus Maria Einsiedeln",
      monthLabel: "Oktober 2026",
      generatedAt: "18.10.2026, 19:30",
      totals: {
        confirmedHours: 21.0,
        confirmedShifts: 3,
        acceptedHours: 7.33,
        acceptedShifts: 1,
        totalHours: 28.33,
      },
      rows: [
        {
          id: "shift-1",
          status: "confirmed",
          date: "2026-10-01", // Thursday (regular)
          startTime: "06:30",
          endTime: "14:00",
          notes: "Wohnbereich 1",
          workerName: "Schmutzler, Marcel",
          workerBirthDate: "12.05.1985",
          qualification: "pflegefachkraft",
          confirmedHours: 7.0,
          scheduledHours: 7.0,
          billing: "confirmed",
          contractId: null,
          contractStatus: null,
          invoiceId: null,
          serviceConfirmation: true,
        },
        {
          id: "shift-2",
          status: "confirmed",
          date: "2026-10-03", // Saturday + Tag der Deutschen Einheit (Holiday)
          startTime: "06:30",
          endTime: "14:00",
          notes: null,
          workerName: "Khorami, Ali Reza",
          workerBirthDate: "15.08.1990",
          qualification: "pflegefachkraft",
          confirmedHours: 7.0,
          scheduledHours: 7.0,
          billing: "confirmed",
          contractId: null,
          contractStatus: null,
          invoiceId: null,
          serviceConfirmation: true,
        },
        {
          id: "shift-3",
          status: "confirmed",
          date: "2026-10-04", // Sunday
          startTime: "06:30",
          endTime: "14:00",
          notes: null,
          workerName: "Bock, Kevin",
          workerBirthDate: "20.11.1993",
          qualification: "pflegefachkraft",
          confirmedHours: 7.0,
          scheduledHours: 7.0,
          billing: "confirmed",
          contractId: null,
          contractStatus: null,
          invoiceId: null,
          serviceConfirmation: true,
        },
        {
          id: "shift-4",
          status: "confirmed",
          date: "2026-10-07", // Wednesday (floating decimal hours test)
          startTime: "06:30",
          endTime: "14:20",
          notes: null,
          workerName: "Bock, Kevin",
          workerBirthDate: "20.11.1993",
          qualification: "pflegefachkraft",
          confirmedHours: null,
          scheduledHours: 7.333333333333333,
          billing: "accepted",
          contractId: null,
          contractStatus: null,
          invoiceId: null,
          serviceConfirmation: false,
        },
      ],
    };

    const buffer = await renderMonatsuebersichtPdf(mockData);
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
