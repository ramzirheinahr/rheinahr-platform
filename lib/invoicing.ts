import { prisma } from "@/lib/prisma";
import type { Qualification, ConfirmationMethod } from "@prisma/client";

export type InvoiceRow = {
  shiftDate: string; // YYYY-MM-DD
  facilityName: string;
  workerName: string;
  qualification: Qualification;
  startTime: string;
  endTime: string;
  hours: number;
  method: ConfirmationMethod;
  confirmedAt: string; // ISO
  orderId: string;
  assignmentId: string;
};

// German business labels for the export (DATEV / accounting is German-language).
export const qualLabel: Record<Qualification, string> = {
  pflegefachkraft: "Pflegefachkraft",
  pflegehelfer: "Pflegehilfskraft",
  betreuungskraft: "Pflegefachassistent*in",
  pflegedienstleitung: "Pflegedienstleitung",
};
export const methodLabel: Record<ConfirmationMethod, string> = {
  electronic: "Elektronische Unterschrift",
  upload: "Dokument-Upload",
};

// Confirmed services in an optional [from, to] shift-date range (inclusive).
export async function getConfirmedServices(opts: {
  from?: string;
  to?: string;
}): Promise<InvoiceRow[]> {
  const shiftDate: { gte?: Date; lt?: Date } = {};
  if (opts.from) shiftDate.gte = new Date(`${opts.from}T00:00:00.000Z`);
  if (opts.to) {
    const end = new Date(`${opts.to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1); // inclusive end day
    shiftDate.lt = end;
  }

  const rows = await prisma.serviceConfirmation.findMany({
    where:
      shiftDate.gte || shiftDate.lt
        ? { assignment: { order: { shiftDate } } }
        : undefined,
    orderBy: { confirmedAt: "desc" },
    select: {
      hoursWorked: true,
      method: true,
      confirmedAt: true,
      assignment: {
        select: {
          id: true,
          worker: { select: { fullName: true, qualification: true } },
          order: {
            select: {
              id: true,
              shiftDate: true,
              startTime: true,
              endTime: true,
              client: { select: { facilityName: true } },
            },
          },
        },
      },
    },
  });

  return rows.map((r) => ({
    shiftDate: r.assignment.order.shiftDate.toISOString().slice(0, 10),
    facilityName: r.assignment.order.client.facilityName,
    workerName: r.assignment.worker.fullName,
    qualification: r.assignment.worker.qualification,
    startTime: r.assignment.order.startTime,
    endTime: r.assignment.order.endTime,
    hours: Number(r.hoursWorked ?? 0),
    method: r.method,
    confirmedAt: r.confirmedAt.toISOString(),
    orderId: r.assignment.order.id,
    assignmentId: r.assignment.id,
  }));
}

function csvCell(value: string | number): string {
  const s = String(value);
  // Quote when the cell contains the delimiter, quotes or a newline.
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Semicolon-delimited CSV with UTF-8 BOM (Excel/DATEV-friendly).
export function toCsv(rows: InvoiceRow[]): string {
  const headers = [
    "Datum",
    "Einrichtung",
    "Fachkraft",
    "Qualifikation",
    "Beginn",
    "Ende",
    "Stunden",
    "Methode",
    "Bestätigt am",
    "Auftrag-ID",
    "Einsatz-ID",
  ];
  const lines = [headers.join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.shiftDate,
        r.facilityName,
        r.workerName,
        qualLabel[r.qualification],
        r.startTime,
        r.endTime,
        r.hours.toString().replace(".", ","), // German decimal comma
        methodLabel[r.method],
        r.confirmedAt.slice(0, 16).replace("T", " "),
        r.orderId,
        r.assignmentId,
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  return "﻿" + lines.join("\r\n");
}
