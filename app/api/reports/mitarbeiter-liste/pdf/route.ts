import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMitarbeiterListeData } from "@/lib/reports-data";
import { renderToStream } from "@react-pdf/renderer";
import React from "react";
import { MitarbeiterListeTemplate } from "@/lib/pdf/mitarbeiter-liste";
import { getCompanyConfig } from "@/lib/config/company";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";
  const clientId = url.searchParams.get("clientId") || "";
  const qualification = url.searchParams.get("qualification") || undefined;

  if (!startDate || !endDate || !clientId) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  try {
    const data = await getMitarbeiterListeData({ startDate, endDate, clientId, qualification });
    const companyConfig = await getCompanyConfig();

    const pdfStream = await renderToStream(
      React.createElement(MitarbeiterListeTemplate, {
        companyConfig,
        clientName: data.client.facilityName,
        startDate,
        endDate,
        rows: data.rows,
      }) as any
    );

    const cleanClient = (data.client.facilityName || "Kunde").replace(/[^a-zA-Z0-9_-]/g, "_");
    return new NextResponse(pdfStream as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Mitarbeiterliste_${cleanClient}_${startDate}_${endDate}.pdf"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "PDF generation failed" }, { status: 500 });
  }
}
