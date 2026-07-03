import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMasterSchedule } from "@/lib/master-schedule";
import { masterScheduleCsv } from "@/lib/master-schedule-core";
import { qualifications } from "@/lib/validations";
import { qualLabel } from "@/lib/invoicing";
import { germanHolidays } from "@/lib/holidays";
import { audit } from "@/lib/audit";
import type { Qualification } from "@prisma/client";

// Master Dienstplan download (admin only) — the Excel-style grid as a
// landscape PDF or Excel-friendly CSV, one qualification per sheet.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  const format = searchParams.get("format") === "pdf" ? "pdf" : "csv";
  const qualification = searchParams.get("qualification") ?? "";
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    year < 2020 ||
    year > 2100 ||
    !(qualifications as readonly string[]).includes(qualification)
  ) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const { rows, facilities, daysInMonth } = await getMasterSchedule(
    qualification as Qualification,
    year,
    month,
  );

  await audit({
    userId: user.id,
    action: "master.schedule.export",
    metadata: { year, month, qualification, format, workers: rows.length },
  });

  const stamp = `${year}-${String(month).padStart(2, "0")}-${qualification}`;

  if (format === "pdf") {
    const { renderDienstplanPdf } = await import("@/lib/pdf/dienstplan");
    const holidays = germanHolidays(year);
    const pad = (n: number) => String(n).padStart(2, "0");
    const tinted = Array.from({ length: daysInMonth }, (_, i) => {
      const date = `${year}-${pad(month)}-${pad(i + 1)}`;
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      return dow === 0 || dow === 6 || holidays.has(date);
    });
    const monthLabel = new Intl.DateTimeFormat("de-DE", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, 1)));
    const pdf = await renderDienstplanPdf({
      qualificationLabel: qualLabel[qualification as Qualification],
      monthLabel,
      daysInMonth,
      tinted,
      rows,
      facilities,
      generatedAt: new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Berlin",
      }).format(new Date()),
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="dienstplan-${stamp}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return new NextResponse(masterScheduleCsv(rows, facilities, daysInMonth), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dienstplan-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
