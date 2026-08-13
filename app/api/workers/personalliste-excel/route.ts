import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMultipleWorkersHoursAccount } from "@/lib/hours-account";
import * as xlsx from "xlsx";

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

  const workers = await prisma.worker.findMany({
    select: { id: true, fullName: true, internalNumber: true },
    orderBy: { fullName: "asc" },
  });

  if (workers.length === 0) {
    return NextResponse.json({ error: "No workers found" }, { status: 404 });
  }

  const workerIds = workers.map((w) => w.id);
  const allHoursAccounts = await getMultipleWorkersHoursAccount(workerIds, month, month);

  const workersData = workers.map((w) => {
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
      "Interne Nr.": w.internalNumber || "-",
      "Vollständiger Name": w.fullName,
      "Stand alt": Number(standAlt.toFixed(2)),
      "Zu-/Abgang": Number(zuAbgang.toFixed(2)),
      "Stand neu": Number(standNeu.toFixed(2)),
    };
  });

  const ws = xlsx.utils.json_to_sheet(workersData);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, `Personalliste ${month}`);

  const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="personalliste_${month}.xlsx"`,
    },
  });
}
