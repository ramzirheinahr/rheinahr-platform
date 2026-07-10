import { prisma } from "@/lib/prisma";
import { qualLabel } from "@/lib/invoicing";
import { netShiftHours, resolveRates, rateFor } from "@/lib/pricing";
import type { AssignmentStatus, Qualification } from "@prisma/client";

// One month of everything worked (or planned) at a client's facility — the
// client-side mirror of the worker schedule table. Two hour figures matter:
//   • `confirmedHours` — the net hours the facility SIGNED on the Leistungs-
//     nachweis (green). These are the invoice basis.
//   • provisional "accepted" hours (amber) — a worker has taken the shift but
//     the facility hasn't signed yet, so we show the SCHEDULED net window.
// No pricing here — the client view is about hours only.
export type ClientScheduleRow = {
  id: string;
  status: AssignmentStatus;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  notes: string | null; // Wohnbereich/Station
  workerName: string;
  qualification: Qualification;
  confirmedHours: number | null; // client-signed net hours (green)
  scheduledHours: number; // net hours of the planned window (amber basis)
  /** Which pot this row counts toward in the totals. */
  billing: "confirmed" | "accepted" | null;
  contractId: string | null;
  contractStatus: string | null;
  invoiceId: string | null;
  serviceConfirmation: boolean;
  hourlyRate?: number;
};

export type ClientScheduleTotals = {
  confirmedHours: number;
  confirmedShifts: number;
  // Accepted-but-not-yet-signed (amber): scheduled hours.
  acceptedHours: number;
  acceptedShifts: number;
  // Confirmed + accepted — the "expected this month" figure shown in the footer.
  totalHours: number;
};

export async function getClientMonthSchedule(
  clientId: string,
  year: number,
  month: number,
): Promise<{ rows: ClientScheduleRow[]; totals: ClientScheduleTotals }> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { hourlyRates: true },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rates = client ? resolveRates(client as any) : resolveRates({ hourlyRates: null } as any);

  const assignments = await prisma.assignment
    .findMany({
      where: {
        order: {
          clientId,
          shiftDate: {
            gte: new Date(Date.UTC(year, month - 1, 1)),
            lt: new Date(Date.UTC(year, month, 1)),
          },
        },
      },
      orderBy: [{ order: { shiftDate: "asc" } }, { order: { startTime: "asc" } }],
      include: {
        order: {
          select: { shiftDate: true, startTime: true, endTime: true, breakMinutes: true, notes: true, requiredQualification: true },
        },
        worker: { select: { fullName: true, qualification: true } },
        serviceConfirmation: { select: { hoursWorked: true } },
        clientContract: { select: { id: true, status: true } },
      },
    })
    .catch(() => []);

  const rows: ClientScheduleRow[] = assignments.map((a) => {
    const o = a.order;
    const isoDate = o.shiftDate.toISOString().slice(0, 10);
    const rawNet = netShiftHours(o.startTime, o.endTime, o.breakMinutes);
    const cNet = a.serviceConfirmation?.hoursWorked != null ? Number(a.serviceConfirmation.hoursWorked) : null;

    return {
      id: a.id,
      status: a.status,
      date: isoDate,
      startTime: o.startTime,
      endTime: o.endTime,
      notes: o.notes,
      workerName: a.worker.fullName,
      qualification: o.requiredQualification,
      confirmedHours: cNet,
      scheduledHours: rawNet,
      billing: cNet !== null ? "confirmed" : a.status === "confirmed" ? "accepted" : null,
      contractId: a.clientContract?.id ?? null,
      contractStatus: a.clientContract?.status ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invoiceId: (a as any).invoiceId ?? null,
      serviceConfirmation: !!a.serviceConfirmation,
      hourlyRate: rateFor(o.requiredQualification, rates),
    };
  });

  const confirmed = rows.filter((r) => r.billing === "confirmed");
  const accepted = rows.filter((r) => r.billing === "accepted");
  const sum = (arr: number[]) => arr.reduce((s, n) => s + n, 0);

  const confirmedHours = sum(confirmed.map((r) => r.confirmedHours ?? 0));
  const acceptedHours = sum(accepted.map((r) => r.scheduledHours));

  return {
    rows,
    totals: {
      confirmedHours,
      confirmedShifts: confirmed.length,
      acceptedHours,
      acceptedShifts: accepted.length,
      totalHours: confirmedHours + acceptedHours,
    },
  };
}

const statusLabel: Record<AssignmentStatus, string> = {
  pending: "Ausstehend",
  confirmed: "Bestätigt",
  declined: "Abgelehnt",
};

// Human status shown next to a row: green (signed), amber (provisional), or raw.
export function rowStatusLabel(r: ClientScheduleRow): string {
  if (r.billing === "confirmed") return "Vom Kunden bestätigt";
  if (r.billing === "accepted") return "Angenommen (vorläufig)";
  return statusLabel[r.status];
}

// The hours that count for this row: signed net hours (green) or, while still
// provisional, the scheduled net hours (amber). Null when nothing counts yet.
export function rowBillHours(r: ClientScheduleRow): number | null {
  if (r.billing === "confirmed") return r.confirmedHours;
  if (r.billing === "accepted") return r.scheduledHours;
  return null;
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const deDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const deNum = (n: number) => n.toString().replace(".", ",");

// Semicolon-delimited CSV with UTF-8 BOM — opens directly in Excel (same
// convention as the DATEV invoicing export). German labels: business exports
// are German-language regardless of UI locale.
export function clientScheduleCsv(
  rows: ClientScheduleRow[],
  totals: ClientScheduleTotals,
): string {
  const headers = [
    "Datum",
    "Pflegekraft",
    "Qualifikation",
    "Wohnbereich",
    "Beginn",
    "Ende",
    "Status",
    "Stunden (ohne Pausen)",
  ];
  const lines = [headers.join(";")];
  for (const r of rows) {
    const hrs = rowBillHours(r);
    lines.push(
      [
        deDate(r.date),
        r.workerName,
        qualLabel[r.qualification],
        r.notes ?? "",
        r.startTime,
        r.endTime,
        rowStatusLabel(r),
        hrs != null ? deNum(hrs) : "",
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  lines.push(
    ["Gesamt (inkl. vorläufig)", "", "", "", "", "", "", deNum(totals.totalHours)].join(";"),
  );
  return "﻿" + lines.join("\r\n");
}
