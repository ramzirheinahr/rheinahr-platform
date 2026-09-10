import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAzkStandData } from "@/lib/reports-data";
import * as xlsx from "xlsx";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || String(new Date().getFullYear()), 10);
  const month = parseInt(url.searchParams.get("month") || String(new Date().getMonth() + 1), 10);

  try {
    const data = await getAzkStandData(year, month);

    const rows = data.rows.map((r) => ({
      "#": r.index,
      Personalnummer: r.internalNumber,
      Nachname: r.lastName,
      Vorname: r.firstName,
      "Stand alt": r.standAlt,
      "Zu- / Abgang": r.zuAbgang,
      "Stand neu": r.standNeu,
    }));

    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    const sheetName = `AZK-Stand ${year}-${String(month).padStart(2, "0")}`;
    xlsx.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `AZK_Stand_${year}_${String(month).padStart(2, "0")}.xlsx`;

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
