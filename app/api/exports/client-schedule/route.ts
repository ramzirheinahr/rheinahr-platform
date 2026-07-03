import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClientMonthSchedule, clientScheduleCsv } from "@/lib/client-schedule";
import { audit } from "@/lib/audit";

// Month overview download for the client portal — the facility's own shifts
// only, as PDF (branded Monatsübersicht) or Excel-friendly CSV.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const client = await prisma.client.findUnique({
    where: { userId: user.id },
    select: { id: true, facilityName: true },
  });
  if (!client) return new NextResponse("Forbidden", { status: 403 });

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  const format = searchParams.get("format") === "pdf" ? "pdf" : "csv";
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 2020 || year > 2100) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const { rows, totals } = await getClientMonthSchedule(client.id, year, month);

  await audit({
    userId: user.id,
    action: "client.schedule.export",
    entity: "Client",
    entityId: client.id,
    metadata: { year, month, format, rows: rows.length },
  });

  const stamp = `${year}-${String(month).padStart(2, "0")}`;

  if (format === "pdf") {
    const { renderMonatsuebersichtPdf } = await import("@/lib/pdf/monatsuebersicht");
    const monthLabel = new Intl.DateTimeFormat("de-DE", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, 1)));
    const pdf = await renderMonatsuebersichtPdf({
      facilityName: client.facilityName,
      monthLabel,
      rows,
      totals,
      generatedAt: new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Berlin",
      }).format(new Date()),
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="monatsuebersicht-${stamp}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return new NextResponse(clientScheduleCsv(rows, totals), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="monatsuebersicht-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
