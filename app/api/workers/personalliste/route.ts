import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMultipleWorkersHoursAccount } from "@/lib/hours-account";
import { renderToStream } from "@react-pdf/renderer";
import React from "react";
import { PersonallisteTemplate } from "@/lib/pdf/personalliste";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "super_admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const month = url.searchParams.get("month") || ""; // YYYY-MM

  if (!month) {
    return NextResponse.json({ error: "Missing month" }, { status: 400 });
  }

  // Fetch all workers
  const allWorkers = await prisma.worker.findMany({
    select: { id: true, fullName: true, internalNumber: true, employedSince: true },
    orderBy: { fullName: "asc" },
  });

  const workers = allWorkers.filter((w) => {
    if (!w.employedSince) return true;
    const employedMonth = w.employedSince.toISOString().slice(0, 7);
    return employedMonth <= month;
  });

  if (workers.length === 0) {
    return NextResponse.json({ error: "No workers found" }, { status: 404 });
  }

  const workerIds = workers.map(w => w.id);
  const allHoursAccounts = await getMultipleWorkersHoursAccount(workerIds, month, month);

  const workersData = workers.map(w => {
    let standAlt = 0;
    let zuAbgang = 0;
    let standNeu = 0;
    
    const hoursAcc = allHoursAccounts[w.id];
    if (hoursAcc) {
      standAlt = hoursAcc.initialCarryover;
      if (hoursAcc.months.length > 0) {
        const m = hoursAcc.months[hoursAcc.months.length - 1];
        zuAbgang = m.monthBalance;
        standNeu = m.cumulativeBalance;
      } else {
        standNeu = standAlt;
      }
    }

    return {
      fullName: w.fullName,
      standAlt,
      zuAbgang,
      standNeu,
    };
  });

  const { getCompanyConfig } = await import("@/lib/config/company");
  const companyConfig = await getCompanyConfig();

  const pdfStream = await renderToStream(
    React.createElement(PersonallisteTemplate, {
      companyConfig,
      data: {
        month,
        workers: workersData,
      },
    }) as any
  );

  return new NextResponse(pdfStream as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="personalliste_${month}.pdf"`,
    },
  });
}
