import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAuegData } from "@/lib/reports-data";
import { renderToStream } from "@react-pdf/renderer";
import React from "react";
import { AuegTemplate } from "@/lib/pdf/aueg";
import { getCompanyConfig } from "@/lib/config/company";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "Missing date range" }, { status: 400 });
  }

  try {
    const data = await getAuegData({ startDate, endDate });
    const companyConfig = await getCompanyConfig();

    const pdfStream = await renderToStream(
      React.createElement(AuegTemplate, {
        companyConfig,
        rows: data.rows,
      }) as any
    );

    return new NextResponse(pdfStream as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Liste_Aueg_${startDate}_${endDate}.pdf"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "PDF generation failed" }, { status: 500 });
  }
}
