import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatDateTimeDE } from "@/lib/utils";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { qualLabel } from "@/lib/invoicing";
import { netShiftHours } from "@/lib/pricing";
import { renderBulkLeistungsnachweisPdf, LeistungsnachweisData } from "@/lib/pdf/leistungsnachweis";

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
      status: "confirmed"
    },
    select: {
      id: true,
      status: true,
      worker: { select: { fullName: true, qualification: true, userId: true } },
      serviceConfirmation: {
        select: {
          method: true,
          hoursWorked: true,
          ipAddress: true,
          confirmedAt: true,
          signatureData: true,
          confirmedBy: { select: { email: true } }
        }
      },
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
    orderBy: { order: { shiftDate: "asc" } }
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

  const entries: LeistungsnachweisData[] = assignments.map(a => {
    // If it's already confirmed, use confirmed hours. Otherwise, use scheduled hours.
    const hours = a.serviceConfirmation 
      ? Number(a.serviceConfirmation.hoursWorked) 
      : netShiftHours(a.order.startTime, a.order.endTime, a.order.breakMinutes);
      
    const isElectronic = a.serviceConfirmation ? a.serviceConfirmation.method === "electronic" : false;
    const confirmedByEmail = a.serviceConfirmation ? (a.serviceConfirmation.confirmedBy?.email || "—") : "";
    const confirmedAt = a.serviceConfirmation ? formatDateTimeDE(a.serviceConfirmation.confirmedAt) : "";

    return {
      facilityName: a.order.client.facilityName,
      workerName: a.worker.fullName,
      qualificationLabel: qualLabel[a.worker.qualification],
      shiftDate: a.order.shiftDate.toISOString().slice(0, 10),
      startTime: a.order.startTime,
      endTime: a.order.endTime,
      hours,
      methodLabel: a.serviceConfirmation ? (a.serviceConfirmation.method === "electronic" ? "Elektronisch" : "Unterschrift (Handschriftlich)") : "Unterschrift (Handschriftlich)",
      isElectronic,
      signatureData: a.serviceConfirmation?.signatureData || null,
      confirmedByEmail,
      confirmedAt,
      ipAddress: a.serviceConfirmation?.ipAddress || null,
      orderId: a.order.id,
      assignmentId: a.id,
      draft: !a.serviceConfirmation,
    };
  });

  const pdf = await renderBulkLeistungsnachweisPdf(entries);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="leistungsnachweise-bulk.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
