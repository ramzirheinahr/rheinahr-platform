import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getReisespesenData } from "@/lib/reports-data";
import { renderToStream } from "@react-pdf/renderer";
import React from "react";
import { ReisespesenTemplate } from "@/lib/pdf/reisespesen";
import { getCompanyConfig } from "@/lib/config/company";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || String(new Date().getFullYear()), 10);
  const month = parseInt(url.searchParams.get("month") || String(new Date().getMonth() + 1), 10);
  const workerId = url.searchParams.get("workerId") || "";

  if (!workerId) {
    return NextResponse.json({ error: "Missing workerId" }, { status: 400 });
  }

  try {
    const data = await getReisespesenData({ year, month, workerId });
    const companyConfig = await getCompanyConfig();

    const pdfStream = await renderToStream(
      React.createElement(ReisespesenTemplate, {
        companyConfig,
        workerName: data.worker.fullName,
        workerNumber: data.worker.internalNumber,
        year,
        month,
        rows: data.rows,
        totalDistance: data.totalDistance,
        totalCost: data.totalCost,
      }) as any
    );

    const cleanWorker = (data.worker.fullName || "Mitarbeiter").replace(/[^a-zA-Z0-9_-]/g, "_");
    return new NextResponse(pdfStream as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Reisespesen_${cleanWorker}_${year}_${month}.pdf"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "PDF generation failed" }, { status: 500 });
  }
}
