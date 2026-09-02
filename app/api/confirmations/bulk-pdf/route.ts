import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { generateLeistungsnachweisePdf } from "@/lib/pdf/generate-timesheets-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids");
  
  if (!idsParam) {
    return new NextResponse("Bad Request: missing ids", { status: 400 });
  }

  const assignmentIds = idsParam.split(",").map(id => id.trim()).filter(Boolean);
  if (assignmentIds.length === 0) {
    return new NextResponse("Bad Request: empty ids", { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const assignments = await prisma.assignment.findMany({
    where: { 
      id: { in: assignmentIds },
    },
    select: {
      id: true,
      worker: { select: { userId: true } },
      order: {
        select: {
          client: { select: { userId: true } },
        },
      },
    },
  });

  if (assignments.length === 0) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Ensure user has permission for ALL requested assignments
  const isAdmin = roleSatisfies(user.role, ["admin"]);
  for (const a of assignments) {
    const allowed = isAdmin || a.order.client.userId === user.id || a.worker.userId === user.id;
    if (!allowed) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const pdfBuffer = await generateLeistungsnachweisePdf(assignmentIds);

  if (!pdfBuffer) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="leistungsnachweise-bulk.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
