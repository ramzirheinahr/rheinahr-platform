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
  const startMonth = url.searchParams.get("start") || ""; // YYYY-MM
  const endMonth = url.searchParams.get("end") || ""; // YYYY-MM

  if (!startMonth || !endMonth) {
    return NextResponse.json({ error: "Missing start or end month" }, { status: 400 });
  }

  const worker = await prisma.worker.findUnique({
    where: { id },
    select: { id: true, fullName: true, userId: true },
  });

  if (!worker) {
    return NextResponse.json({ error: "Worker not found" }, { status: 404 });
  }

  if (user.role === "worker" && worker.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const hoursAcc = await getWorkerHoursAccount(id, startMonth, endMonth);

  const pdfStream = await renderToStream(
    React.createElement(ArbeitszeitkontoTemplate, {
      data: {
        workerName: worker.fullName,
        workerId: worker.id,
        startMonth,
        endMonth,
        months: hoursAcc.months,
      },
    }) as any
  );

  return new NextResponse(pdfStream as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="arbeitszeitkonto_${worker.fullName}_${startMonth}_${endMonth}.pdf"`,
    },
  });
}
