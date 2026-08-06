import { NextResponse } from "next/server";
import { getCurrentUser, resolveClientId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { netShiftHours } from "@/lib/pricing";
import type { ClientScheduleRow, ClientScheduleTotals } from "@/lib/client-schedule";

export async function GET(req: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const user = await getCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "super_admin";
  
  if (!user) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { requestId } = await params;
  
  let clientId = null;
  if (!isStaff) {
    clientId = await resolveClientId(user);
    if (!clientId) return new NextResponse("Forbidden", { status: 403 });
  }

  // Fetch the orders for this request group
  const orders = await prisma.order.findMany({
    where: {
      requestGroupId: requestId,
      ...(clientId ? { clientId } : {}),
    },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
    include: {
      client: { select: { id: true, facilityName: true } },
      assignments: {
        include: {
          worker: { select: { fullName: true, qualification: true } },
          serviceConfirmation: { select: { hoursWorked: true } },
        }
      }
    },
  });

  if (!orders || orders.length === 0) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const facilityName = orders[0].client.facilityName;

  const rows: ClientScheduleRow[] = orders.flatMap((o) => {
    const isoDate = o.shiftDate.toISOString().slice(0, 10);
    const rawNet = netShiftHours(o.startTime, o.endTime, o.breakMinutes);
    
    if (o.assignments.length === 0) {
      // Empty shift without assignment
      return [{
        id: o.id,
        status: o.status === "cancelled" ? "cancelled" : o.status === "in_progress" ? "in_progress" : o.status === "completed" ? "completed" : "pending",
        date: isoDate,
        startTime: o.startTime,
        endTime: o.endTime,
        notes: o.notes,
        workerName: "",
        qualification: o.requiredQualification as any,
        confirmedHours: null,
        scheduledHours: rawNet,
        billing: null as any,
        contractId: null,
        contractStatus: null,
        invoiceId: null,
        serviceConfirmation: false,
      }];
    }
    
    return o.assignments.map((a) => {
      const cNet = a.serviceConfirmation?.hoursWorked != null ? Number(a.serviceConfirmation.hoursWorked) : null;
      return {
        id: a.id,
        status: a.status as any,
        date: isoDate,
        startTime: o.startTime,
        endTime: o.endTime,
        notes: o.notes,
        workerName: a.worker.fullName,
        qualification: o.requiredQualification as any,
        confirmedHours: cNet,
        scheduledHours: rawNet,
        billing: (cNet !== null ? "confirmed" : a.status === "confirmed" ? "accepted" : ((a.status as string) === "assigned" ? "assigned" : null)) as any,
        contractId: null,
        contractStatus: null,
        invoiceId: null,
        serviceConfirmation: !!a.serviceConfirmation,
      };
    });
  });

  const confirmed = rows.filter((r) => r.billing === "confirmed");
  const accepted = rows.filter((r) => r.billing === "accepted" || (r.billing as string) === "assigned" || !r.billing);
  const sum = (arr: number[]) => arr.reduce((s, n) => s + n, 0);

  const confirmedHours = sum(confirmed.map((r) => r.confirmedHours ?? 0));
  const acceptedHours = sum(accepted.map((r) => r.scheduledHours));

  const totals: ClientScheduleTotals = {
    confirmedHours,
    confirmedShifts: confirmed.length,
    acceptedHours,
    acceptedShifts: accepted.length,
    totalHours: confirmedHours + acceptedHours,
  };

  await audit({
    userId: user.id,
    action: "order_request.export",
    entity: "OrderGroup",
    entityId: requestId,
    metadata: { rows: rows.length },
  });

  const { renderOrderRequestPdf } = await import("@/lib/pdf/order-request");
  
  const createdDate = orders[0].createdAt ? new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeZone: "Europe/Berlin",
  }).format(orders[0].createdAt) : "unbekannt";
  
  const pdf = await renderOrderRequestPdf({
    facilityName,
    requestLabel: `vom ${createdDate}`,
    rows,
    totals,
    generatedAt: new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    }).format(new Date()),
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="anfrage-${requestId.substring(0,8)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
