import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { qualLabel } from "@/lib/invoicing";
import { netShiftHours } from "@/lib/pricing";
import { renderLeistungsnachweisPdf } from "@/lib/pdf/leistungsnachweis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Renders the DRAFT (unsigned) Leistungsnachweis so the client can review the
// exact document before signing it — mirrors the "show PDF, then sign" flow.
// Available for a worker-confirmed assignment that has not been confirmed yet.
// Access: admin/super_admin, the owning client, or the assigned worker.
export async function GET(req: Request, props: { params: Promise<{ assignmentId: string }> }) {
  const params = await props.params;
  const { assignmentId } = params;
  const url = new URL(req.url);
  const requestGroupIdParam = url.searchParams.get("requestGroupId");

  const user = await getCurrentUser();
  if (!user && !requestGroupIdParam) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      status: true,
      worker: { select: { fullName: true, qualification: true, userId: true } },
      order: {
        select: {
          id: true,
          requestGroupId: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          breakMinutes: true,
          client: { select: { facilityName: true, userId: true } },
        },
      },
    },
  });
  if (!a || a.status !== "confirmed") {
    return new NextResponse("Not found", { status: 404 });
  }

  let allowed = false;
  if (user) {
    allowed =
      roleSatisfies(user.role, ["admin"]) ||
      a.order.client.userId === user.id ||
      a.worker.userId === user.id;
  } else if (requestGroupIdParam) {
    allowed = a.order.requestGroupId === requestGroupIdParam;
  }
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  // Optional live hours from the confirmation form; else the scheduled net hours.
  const hoursParam = new URL(req.url).searchParams.get("hours");
  const parsedHours = hoursParam !== null ? Number(hoursParam) : NaN;
  const hours =
    Number.isFinite(parsedHours) && parsedHours >= 0 && parsedHours <= 24
      ? parsedHours
      : netShiftHours(a.order.startTime, a.order.endTime, a.order.breakMinutes);

  const pdf = await renderLeistungsnachweisPdf({
    facilityName: a.order.client.facilityName,
    workerName: a.worker.fullName,
    qualificationLabel: qualLabel[a.worker.qualification],
    shiftDate: a.order.shiftDate.toISOString().slice(0, 10),
    startTime: a.order.startTime,
    endTime: a.order.endTime,
    hours,
    methodLabel: "Unterschrift (Handschriftlich)",
    isElectronic: false,
    signatureData: null,
    confirmedByEmail: user?.email || "Öffentlicher Link",
    confirmedAt: "",
    ipAddress: null,
    orderId: a.order.id,
    assignmentId: a.id,
    draft: false,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="leistungsnachweis-manuell.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
