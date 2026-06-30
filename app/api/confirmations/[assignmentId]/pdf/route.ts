import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { qualLabel, methodLabel } from "@/lib/invoicing";
import { renderLeistungsnachweisPdf } from "@/lib/pdf/leistungsnachweis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Renders the signed Leistungsnachweis as a PDF. Access: admin/super_admin,
// the owning client, or the assigned worker.
export async function GET(
  _req: Request,
  { params }: { params: { assignmentId: string } },
) {
  const { assignmentId } = params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      worker: { select: { fullName: true, qualification: true, userId: true } },
      order: {
        select: {
          id: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          client: { select: { facilityName: true, userId: true } },
        },
      },
      serviceConfirmation: {
        select: {
          method: true,
          hoursWorked: true,
          signatureData: true,
          confirmedAt: true,
          ipAddress: true,
          confirmedBy: { select: { email: true } },
        },
      },
    },
  });

  const sc = a?.serviceConfirmation;
  if (!a || !sc) return new NextResponse("Not found", { status: 404 });

  const allowed =
    roleSatisfies(user.role, ["admin"]) ||
    a.order.client.userId === user.id ||
    a.worker.userId === user.id;
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  const pdf = await renderLeistungsnachweisPdf({
    facilityName: a.order.client.facilityName,
    workerName: a.worker.fullName,
    qualificationLabel: qualLabel[a.worker.qualification],
    shiftDate: a.order.shiftDate.toISOString().slice(0, 10),
    startTime: a.order.startTime,
    endTime: a.order.endTime,
    hours: Number(sc.hoursWorked ?? 0),
    methodLabel: methodLabel[sc.method],
    isElectronic: sc.method === "electronic",
    signatureData: sc.signatureData,
    confirmedByEmail: sc.confirmedBy?.email ?? "—",
    confirmedAt: sc.confirmedAt.toISOString().slice(0, 16).replace("T", " "),
    ipAddress: sc.ipAddress,
    orderId: a.order.id,
    assignmentId: a.id,
  });

  await audit({
    userId: user.id,
    action: "leistungsnachweis.pdf",
    entity: "Assignment",
    entityId: assignmentId,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="leistungsnachweis-${a.order.shiftDate
        .toISOString()
        .slice(0, 10)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
