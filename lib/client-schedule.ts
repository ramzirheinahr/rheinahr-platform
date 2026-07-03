import { prisma } from "@/lib/prisma";
import { qualLabel } from "@/lib/invoicing";
import type { AssignmentStatus, Qualification } from "@prisma/client";

// One month of everything worked (or planned) at a client's facility — the
// client-side mirror of the worker schedule table. `confirmedHours` is what
// the facility signed on the Leistungsnachweis, i.e. net of the break, so the
// month total matches the invoice.
export type ClientScheduleRow = {
  id: string;
  status: AssignmentStatus;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  notes: string | null; // Wohnbereich/Station
  workerName: string;
  qualification: Qualification;
  confirmedHours: number | null;
};

export type ClientScheduleTotals = {
  confirmedHours: number;
  confirmedShifts: number;
};

export async function getClientMonthSchedule(
  clientId: string,
  year: number,
  month: number,
): Promise<{ rows: ClientScheduleRow[]; totals: ClientScheduleTotals }> {
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
          select: { shiftDate: true, startTime: true, endTime: true, notes: true },
        },
        worker: { select: { fullName: true, qualification: true } },
        serviceConfirmation: { select: { hoursWorked: true } },
      },
    })
    .catch(() => []);

  const rows: ClientScheduleRow[] = assignments.map((a) => ({
    id: a.id,
    status: a.status,
    date: a.order.shiftDate.toISOString().slice(0, 10),
    startTime: a.order.startTime,
    endTime: a.order.endTime,
    notes: a.order.notes,
    workerName: a.worker.fullName,
    qualification: a.worker.qualification,
    confirmedHours:
      a.serviceConfirmation?.hoursWorked != null
        ? Number(a.serviceConfirmation.hoursWorked)
        : null,
  }));

  const confirmed = rows.filter((r) => r.confirmedHours != null);
  return {
    rows,
    totals: {
      confirmedHours: confirmed.reduce((sum, r) => sum + (r.confirmedHours ?? 0), 0),
      confirmedShifts: confirmed.length,
    },
  };
}

const statusLabel: Record<AssignmentStatus, string> = {
  pending: "Ausstehend",
  confirmed: "Bestätigt",
  declined: "Abgelehnt",
};

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
    "Bestätigte Stunden (ohne Pausen)",
  ];
  const lines = [headers.join(";")];
  for (const r of rows) {
    lines.push(
      [
        deDate(r.date),
        r.workerName,
        qualLabel[r.qualification],
        r.notes ?? "",
        r.startTime,
        r.endTime,
        r.confirmedHours != null ? "Vom Kunden bestätigt" : statusLabel[r.status],
        r.confirmedHours != null ? deNum(r.confirmedHours) : "",
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  lines.push(
    ["Gesamt", "", "", "", "", "", "", deNum(totals.confirmedHours)].join(";"),
  );
  return "﻿" + lines.join("\r\n");
}
