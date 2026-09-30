import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getWorkerHoursAccount } from "@/lib/hours-account";
import { renderToStream } from "@react-pdf/renderer";
import React from "react";
import { BatchArbeitszeitkontoTemplate, ArbeitszeitkontoPdfData } from "@/lib/pdf/arbeitszeitkonto";
import { getCompanyConfig } from "@/lib/config/company";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let workerIds: string[] = [];
  let rawStart = "";
  let rawEnd = "";
  let withPrevBalance = true;

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await req.json();
    workerIds = body.workerIds || [];
    rawStart = body.start || body.startMonth || "";
    rawEnd = body.end || body.endMonth || "";
    withPrevBalance = body.withPrevBalance !== false && body.withPrevBalance !== "false";
  } else {
    // Form data submission (e.g. form.submit() with target="_blank")
    const formData = await req.formData();
    const payloadStr = formData.get("payload");
    if (typeof payloadStr === "string") {
      try {
        const body = JSON.parse(payloadStr);
        workerIds = body.workerIds || [];
        rawStart = body.start || body.startMonth || "";
        rawEnd = body.end || body.endMonth || "";
        withPrevBalance = body.withPrevBalance !== false && body.withPrevBalance !== "false";
      } catch (e) {
        console.error("Failed to parse payload in form data", e);
      }
    } else {
      const rawIds = formData.get("workerIds");
      if (typeof rawIds === "string") {
        workerIds = rawIds.split(",").map((s) => s.trim()).filter(Boolean);
      }
      rawStart = (formData.get("start") as string) || "";
      rawEnd = (formData.get("end") as string) || "";
      withPrevBalance = formData.get("withPrevBalance") !== "false";
    }
  }

  return generateBatchPdf({ workerIds, rawStart, rawEnd, withPrevBalance });
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const workerIdsStr = url.searchParams.get("workerIds") || "";
  const workerIds = workerIdsStr.split(",").map((s) => s.trim()).filter(Boolean);
  const rawStart = url.searchParams.get("start") || url.searchParams.get("startMonth") || "";
  const rawEnd = url.searchParams.get("end") || url.searchParams.get("endMonth") || "";
  const withPrevBalance = url.searchParams.get("withPrevBalance") !== "false";

  return generateBatchPdf({ workerIds, rawStart, rawEnd, withPrevBalance });
}

async function generateBatchPdf(params: {
  workerIds: string[];
  rawStart: string;
  rawEnd: string;
  withPrevBalance: boolean;
}) {
  const { workerIds, rawStart, rawEnd, withPrevBalance } = params;

  if (!workerIds || workerIds.length === 0) {
    return NextResponse.json({ error: "No worker IDs provided" }, { status: 400 });
  }

  const now = new Date();
  const currentMonthStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const endMonth = rawEnd || currentMonthStr;

  const workers = await prisma.worker.findMany({
    where: { id: { in: workerIds } },
    select: {
      id: true,
      fullName: true,
      internalNumber: true,
      employmentStartDate: true,
      employedSince: true,
      employmentEndDate: true,
    },
    orderBy: { fullName: "asc" },
  });

  const companyConfig = await getCompanyConfig();
  const pdfItems: ArbeitszeitkontoPdfData[] = [];

  // Process workers sequentially or in parallel batches
  for (const worker of workers) {
    const joinDate = worker.employmentStartDate || worker.employedSince;
    const joinMonth = joinDate ? joinDate.toISOString().slice(0, 7) : null;

    let workerStartMonth: string;
    if (!rawStart || rawStart === "auto") {
      workerStartMonth = joinMonth && joinMonth > "2026-07" ? joinMonth : "2026-07";
    } else {
      workerStartMonth = rawStart < "2026-07" ? "2026-07" : rawStart;
    }

    const hoursAcc = await getWorkerHoursAccount(worker.id, workerStartMonth, endMonth);
    const actualStartMonthForPdf = hoursAcc.months.length > 0 ? hoursAcc.months[0].month : workerStartMonth;
    const actualEndMonthForPdf = hoursAcc.months.length > 0 ? hoursAcc.months[hoursAcc.months.length - 1].month : endMonth;

    const initialCarryover = withPrevBalance ? hoursAcc.initialCarryover : 0;
    const pdfMonths = withPrevBalance
      ? hoursAcc.months
      : hoursAcc.months.map((m) => ({
          ...m,
          cumulativeBalance: Math.round((m.cumulativeBalance - hoursAcc.initialCarryover) * 100) / 100,
        }));

    pdfItems.push({
      workerName: worker.fullName,
      workerId: worker.id,
      workerNumber: worker.internalNumber,
      startMonth: actualStartMonthForPdf,
      endMonth: actualEndMonthForPdf,
      months: pdfMonths,
      initialCarryover,
    });
  }

  if (pdfItems.length === 0) {
    return NextResponse.json({ error: "No valid worker data to generate PDF" }, { status: 404 });
  }

  const pdfStream = await renderToStream(
    React.createElement(BatchArbeitszeitkontoTemplate, {
      companyConfig,
      items: pdfItems,
    }) as any
  );

  return new NextResponse(pdfStream as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="arbeitszeitkonto_sammel_${pdfItems.length}_mitarbeiter.pdf"`,
    },
  });
}
