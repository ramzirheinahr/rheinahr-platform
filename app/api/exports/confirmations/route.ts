import { NextResponse } from "next/server";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { getConfirmedServices, toCsv } from "@/lib/invoicing";
import { audit } from "@/lib/audit";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// Invoicing export — confirmed services as a DATEV-friendly CSV. Admin only.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const range = {
    from: from && dateRegex.test(from) ? from : undefined,
    to: to && dateRegex.test(to) ? to : undefined,
  };

  const rows = await getConfirmedServices(range);
  const csv = toCsv(rows);

  await audit({
    userId: user.id,
    action: "invoice.export",
    entity: "ServiceConfirmation",
    metadata: { count: rows.length, from: range.from ?? null, to: range.to ?? null },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leistungen-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
