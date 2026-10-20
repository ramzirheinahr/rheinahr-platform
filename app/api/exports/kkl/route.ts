import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getKklReportData, kklToCsv } from "@/lib/kkl";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "super_admin";
  if (!user || (!isStaff && user.role !== "client")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(req.url);

  const clientId = isStaff
    ? searchParams.get("clientId")
    : (await prisma.client.findUnique({
        where: { userId: user.id },
        select: { id: true },
      }))?.id;

  if (!clientId) return new NextResponse("Forbidden", { status: 403 });

  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  const requestedFormat = (searchParams.get("format") || "pdf").toLowerCase();
  const format =
    requestedFormat === "docx" || requestedFormat === "word"
      ? "docx"
      : requestedFormat === "csv" || requestedFormat === "excel"
        ? "csv"
        : "pdf";

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

  const data = await getKklReportData(clientId, year, month);
  if (!data) return new NextResponse("Not Found", { status: 404 });

  await audit({
    userId: user.id,
    action: "client.schedule.export",
    entity: "Client",
    entityId: clientId,
    metadata: {
      type: "kkl",
      year,
      month,
      format,
      rows: data.rows.length,
    },
  });

  const monthPadded = String(month).padStart(2, "0");
  const baseFilename = `KKL-${data.client.facilityName}-${monthPadded}-${year}`;
  const sanitizedAscii = baseFilename
    .replace(/[äÄ]/g, "ae")
    .replace(/[öÖ]/g, "oe")
    .replace(/[üÜ]/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-zA-Z0-9._-]/g, "_");

  const encodedUtf8 = encodeURIComponent(`${baseFilename}.${format}`);

  if (format === "csv") {
    const csvContent = kklToCsv(data);
    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sanitizedAscii}.csv"; filename*=UTF-8''${encodedUtf8}`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "docx") {
    const { renderKklDocx } = await import("@/lib/docx/kkl");
    const docxBuffer = await renderKklDocx(data);

    return new NextResponse(new Uint8Array(docxBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${sanitizedAscii}.docx"; filename*=UTF-8''${encodedUtf8}`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Format: PDF
  const { renderKklPdf } = await import("@/lib/pdf/kkl");
  const pdfBuffer = await renderKklPdf(data);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${sanitizedAscii}.pdf"; filename*=UTF-8''${encodedUtf8}`,
      "Cache-Control": "no-store",
    },
  });
}
