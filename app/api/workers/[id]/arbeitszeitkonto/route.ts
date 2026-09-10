import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWorkerHoursAccount } from "@/lib/hours-account";
import { renderToStream } from "@react-pdf/renderer";
import React from "react";
import { ArbeitszeitkontoTemplate } from "@/lib/pdf/arbeitszeitkonto";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const url = new URL(req.url);
  const rawStart = url.searchParams.get("start") || url.searchParams.get("startMonth") || "";
  const rawEnd = url.searchParams.get("end") || url.searchParams.get("endMonth") || "";
  const withPrevBalance = url.searchParams.get("withPrevBalance") !== "false";

  const now = new Date();
  const currentMonthStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const endMonth = rawEnd || currentMonthStr;

  const worker = await prisma.worker.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      internalNumber: true,
      userId: true,
      employmentStartDate: true,
      employedSince: true,
      employmentEndDate: true,
    },
  });

  if (!worker) {
    return NextResponse.json({ error: "Worker not found" }, { status: 404 });
  }

  if (user.role === "worker" && worker.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Determine worker's employment start month
  const joinDate = worker.employmentStartDate || worker.employedSince;
  const joinMonth = joinDate ? joinDate.toISOString().slice(0, 7) : null;

  // Earliest start month is July 2026 (when system started) or when worker joined
  let workerStartMonth: string;
  if (!rawStart || rawStart === "auto") {
    workerStartMonth = joinMonth && joinMonth > "2026-07" ? joinMonth : "2026-07";
  } else {
    workerStartMonth = rawStart < "2026-07" ? "2026-07" : rawStart;
  }

  // Calculate historical account from workerStartMonth up to the requested endMonth
  const hoursAcc = await getWorkerHoursAccount(id, workerStartMonth, endMonth);
  const actualStartMonthForPdf = hoursAcc.months.length > 0 ? hoursAcc.months[0].month : workerStartMonth;
  const actualEndMonthForPdf = hoursAcc.months.length > 0 ? hoursAcc.months[hoursAcc.months.length - 1].month : endMonth;

  const initialCarryover = withPrevBalance ? hoursAcc.initialCarryover : 0;
  const pdfMonths = withPrevBalance
    ? hoursAcc.months
    : hoursAcc.months.map((m) => ({
        ...m,
        cumulativeBalance: Math.round((m.cumulativeBalance - hoursAcc.initialCarryover) * 100) / 100,
      }));

  const { getCompanyConfig } = await import("@/lib/config/company");
  const companyConfig = await getCompanyConfig();

  const pdfStream = await renderToStream(
    React.createElement(ArbeitszeitkontoTemplate, {
      companyConfig,
      data: {
        workerName: worker.fullName,
        workerId: worker.id,
        workerNumber: worker.internalNumber,
        startMonth: actualStartMonthForPdf,
        endMonth: actualEndMonthForPdf,
        months: pdfMonths,
        initialCarryover,
      },
    }) as any
  );

  return new NextResponse(pdfStream as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="arbeitszeitkonto_${worker.fullName}_${actualStartMonthForPdf}_${actualEndMonthForPdf}.pdf"`,
    },
  });
}
