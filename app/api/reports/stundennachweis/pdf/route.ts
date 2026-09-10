import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getStundennachweisData } from "@/lib/reports-data";
import { renderToStream } from "@react-pdf/renderer";
import React from "react";
import { StundennachweisTemplate } from "@/lib/pdf/stundennachweis";
import { getCompanyConfig } from "@/lib/config/company";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";
  const clientId = url.searchParams.get("clientId") || undefined;
  const qualification = url.searchParams.get("qualification") || undefined;

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "Missing date range" }, { status: 400 });
  }

  try {
    const data = await getStundennachweisData({ startDate, endDate, clientId, qualification });
    const companyConfig = await getCompanyConfig();

    const pdfStream = await renderToStream(
      React.createElement(StundennachweisTemplate, {
        companyConfig,
        client: data.client,
        startDate,
        endDate,
        qualificationLabel: qualification || "Pflegehilfskraft",
        rows: data.rows,
      }) as any
    );

    return new NextResponse(pdfStream as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="stundennachweis_${startDate}_${endDate}.pdf"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "PDF generation failed" }, { status: 500 });
  }
}
