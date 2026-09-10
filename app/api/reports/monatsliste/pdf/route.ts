import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMonatslisteData } from "@/lib/reports-data";
import { renderToStream } from "@react-pdf/renderer";
import React from "react";
import { MonatslisteTemplate } from "@/lib/pdf/monatsliste";
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
  const clientId = url.searchParams.get("clientId") || undefined;

  if (!workerId) {
    return NextResponse.json({ error: "Missing workerId" }, { status: 400 });
  }

  try {
    const data = await getMonatslisteData({ year, month, workerId, clientId });
    const companyConfig = await getCompanyConfig();

    const pdfStream = await renderToStream(
      React.createElement(MonatslisteTemplate, {
        companyConfig,
        workerName: data.worker.fullName,
        workerNumber: data.worker.internalNumber,
        year,
        month,
        rows: data.rows,
      }) as any
    );

    const cleanWorker = (data.worker.fullName || "Mitarbeiter").replace(/[^a-zA-Z0-9_-]/g, "_");
    return new NextResponse(pdfStream as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Monatsliste_${cleanWorker}_${year}_${month}.pdf"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "PDF generation failed" }, { status: 500 });
  }
}
