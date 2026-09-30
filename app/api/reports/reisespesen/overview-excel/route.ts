import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMonthlySpesenOverviewData } from "@/lib/reports-data";
import * as xlsx from "xlsx";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || String(new Date().getFullYear()), 10);
  const month = parseInt(url.searchParams.get("month") || String(new Date().getMonth() + 1), 10);
  const onlyWithAmounts = url.searchParams.get("onlyWithAmounts") !== "false";

  try {
    const data = await getMonthlySpesenOverviewData({ year, month, onlyWithAmounts });

    const rows = data.rows.map((r, index) => ({
      "#": index + 1,
      "Personal-Nr.": r.internalNumber || "-",
      Mitarbeiter: r.fullName,
      "Anzahl Fahrten": r.shiftCount,
      "Fahrtstrecke (km)": r.totalDistanceKm,
      "Fahrtkosten (€)": r.totalFahrtCost,
      "Verpflegungsmehraufwand (€)": r.totalMealAllowance,
      "Gesamterstattung (€)": r.totalAmount,
    }));

    // Add total summary row
    rows.push({
      "#": "" as any,
      "Personal-Nr.": "",
      Mitarbeiter: "Gesamtsumme",
      "Anzahl Fahrten": data.totals.totalShifts as any,
      "Fahrtstrecke (km)": data.totals.totalDistanceKm as any,
      "Fahrtkosten (€)": data.totals.totalFahrtCost as any,
      "Verpflegungsmehraufwand (€)": data.totals.totalMealAllowance as any,
      "Gesamterstattung (€)": data.totals.totalAmount as any,
    });

    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    const sheetName = `Spesen ${year}-${String(month).padStart(2, "0")}`;
    xlsx.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `Spesenuebersicht_Fahrt_Verpflegung_${year}_${String(month).padStart(2, "0")}.xlsx`;

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
