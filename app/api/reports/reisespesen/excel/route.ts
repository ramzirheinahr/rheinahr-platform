import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getReisespesenData } from "@/lib/reports-data";
import * as xlsx from "xlsx";

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

    const rows = data.rows.map((r) => ({
      "#": r.index,
      Datum: r.date,
      "Schicht von": r.fromTime,
      "Schicht bis": r.toTime,
      Kunde: r.customerName,
      "Adresse von": r.addressFrom,
      "Adresse nach": r.addressTo,
      "Entfernung (km)": r.distanceKm,
      "Gesamtkosten (€)": r.totalCost,
    }));

    // Add total summary row
    rows.push({
      "#": "Gesamt" as any,
      Datum: "",
      "Schicht von": "",
      "Schicht bis": "",
      Kunde: "",
      "Adresse von": "",
      "Adresse nach": "",
      "Entfernung (km)": data.totalDistance as any,
      "Gesamtkosten (€)": data.totalCost as any,
    });

    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    const sheetName = `Reisespesen ${year}-${String(month).padStart(2, "0")}`;
    xlsx.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    const cleanWorkerName = (data.worker.fullName || "Mitarbeiter").replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `Reisespesen_${cleanWorkerName}_${year}_${String(month).padStart(2, "0")}.xlsx`;

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to generate Excel" }, { status: 500 });
  }
}
