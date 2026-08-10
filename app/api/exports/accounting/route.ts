import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    year < 2020 ||
    year > 2100
  ) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const firstDayOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  try {
    const assignments = await prisma.assignment.findMany({
      where: {
        order: {
          shiftDate: {
            gte: firstDayOfMonth,
            lte: lastDayOfMonth,
          },
          status: {
            in: ["assigned", "accepted", "in_progress", "completed", "confirmed"],
          },
        },
        status: {
          not: "declined",
        },
      },
      include: {
        order: true,
        worker: true,
        serviceConfirmation: true,
      },
      orderBy: [
        { worker: { internalNumber: "asc" } },
        { order: { shiftDate: "asc" } },
        { order: { startTime: "asc" } },
      ],
    });

    await audit({
      userId: user.id,
      action: "accounting.export",
      metadata: { year, month, records: assignments.length },
    });

    const lines: string[] = [];
    // Row 1
    lines.push("Musterfirma;;;;");
    // Row 2
    lines.push("Perso-Nr.;Datum;Beginn;Ende;Pause unbezahlt");

    const pad = (n: number) => String(n).padStart(2, "0");

    for (const assignment of assignments) {
      const workerNo = assignment.worker.internalNumber || "";
      
      const date = assignment.order.shiftDate;
      const dateStr = `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;

      // Prefer ServiceConfirmation times if there is a correction, but ServiceConfirmation 
      // doesn't typically store startTime/endTime unless requestedStart/requestedEnd is present.
      // After approval, requestedStart/End are applied to the order itself.
      // So order.startTime and order.endTime are the actual times.
      const startTime = assignment.order.startTime;
      const endTime = assignment.order.endTime;

      const breakMins = assignment.order.breakMinutes || 0;
      const breakHours = Math.floor(breakMins / 60);
      const breakRemainder = breakMins % 60;
      const breakStr = `${pad(breakHours)}:${pad(breakRemainder)}`;

      lines.push(`${workerNo};${dateStr};${startTime};${endTime};${breakStr}`);
    }

    const csvContent = lines.join("\r\n");

    const stamp = `${year}-${String(month).padStart(2, "0")}`;
    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="Buchhaltung_${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Accounting export error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
