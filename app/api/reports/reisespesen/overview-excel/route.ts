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

    const rows = data.rows.map((r) => ({
      "Personal-Nr.": r.internalNumber || "-",
      Mitarbeiter: r.fullName,
      "Fahrtkosten (€)": r.totalFahrtCost,
      "Verpflegungsmehraufwand (€)": r.totalMealAllowance,
      "Gesamterstattung (€)": r.totalAmount,
    }));

    // Add total summary row
    rows.push({
      "Personal-Nr.": "",
      Mitarbeiter: "Gesamtsumme",
      "Fahrtkosten (€)": data.totals.totalFahrtCost as any,
      "Verpflegungsmehraufwand (€)": data.totals.totalMealAllowance as any,
      "Gesamterstattung (€)": data.totals.totalAmount as any,
    });

    const ws = xlsx.utils.json_to_sheet(rows);

    ws["!cols"] = [
      { wch: 15 }, // Personal-Nr.
      { wch: 30 }, // Mitarbeiter
      { wch: 18 }, // Fahrtkosten (€)
      { wch: 28 }, // Verpflegungsmehraufwand (€)
      { wch: 22 }, // Gesamterstattung (€)
    ];

    const range = xlsx.utils.decode_range(ws["!ref"] || "A1");
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      for (let C = 2; C <= 4; ++C) {
        const cellRef = xlsx.utils.encode_cell({ r: R, c: C });
        const cell = ws[cellRef];
        if (cell && typeof cell.v === "number") {
          cell.z = "#,##0.00";
        }
      }
    }

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
