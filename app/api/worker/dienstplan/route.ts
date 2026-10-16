import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildWorkerDienstplanPdfData } from "@/lib/worker-dienstplan-builder";
import { generateWorkerDienstplanPdf } from "@/lib/pdf/worker-dienstplan";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const worker = await prisma.worker.findUnique({
    where: { userId: user.id },
    select: { id: true, fullName: true },
  });

  if (!worker) {
    return new NextResponse("Worker record not found for user", { status: 404 });
  }

  const url = new URL(req.url);
  const now = new Date();
  const year = parseInt(url.searchParams.get("year") || `${now.getUTCFullYear()}`, 10);
  const month = parseInt(url.searchParams.get("month") || `${now.getUTCMonth() + 1}`, 10);

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return new NextResponse("Invalid year or month", { status: 400 });
  }

  try {
    const pdfData = await buildWorkerDienstplanPdfData(worker.id, year, month);
    const pdfBuffer = await generateWorkerDienstplanPdf(pdfData);

    const safeName = worker.fullName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const monthPad = month.toString().padStart(2, "0");
    const filename = `Dienstplan_${safeName}_${monthPad}-${year}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Failed to generate Dienstplan PDF for worker:", error);
    return new NextResponse("Failed to generate Dienstplan PDF", { status: 500 });
  }
}
