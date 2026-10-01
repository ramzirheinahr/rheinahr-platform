"use server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { netShiftHours } from "@/lib/pricing";
import { sendEmailToRecipients } from "@/lib/email";
import { qualLabel } from "@/lib/invoicing";
import { formatDateDE } from "@/lib/utils";
import type { ClientScheduleRow, ClientScheduleTotals } from "@/lib/client-schedule";

export async function sendOrderScheduleEmail({
  requestGroupId,
  recipients,
}: {
  requestGroupId: string;
  recipients?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return { ok: false, error: "forbidden" };
  }

  const orders = await prisma.order.findMany({
    where: { requestGroupId },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
    include: {
      client: { select: { id: true, facilityName: true, userId: true } },
      assignments: {
        include: {
          worker: { select: { fullName: true, qualification: true } },
          serviceConfirmation: { select: { hoursWorked: true } },
        },
      },
    },
  });

  if (!orders || orders.length === 0) {
    return { ok: false, error: "not_found" };
  }

  const client = orders[0].client;
  const facilityName = client.facilityName;

  const rows: ClientScheduleRow[] = orders.flatMap((o) => {
    const isoDate = o.shiftDate.toISOString().slice(0, 10);
    const rawNet = netShiftHours(o.startTime, o.endTime, o.breakMinutes);

    if (o.assignments.length === 0) {
      return [
        {
          id: o.id,
          status:
            o.status === "cancelled"
              ? "cancelled"
              : o.status === "in_progress"
              ? "in_progress"
              : o.status === "completed"
              ? "completed"
              : "pending",
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
        },
      ];
    }

    return o.assignments.map((a) => {
      const cNet =
        a.serviceConfirmation?.hoursWorked != null
          ? Number(a.serviceConfirmation.hoursWorked)
          : null;
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
        billing: (cNet !== null
          ? "confirmed"
          : a.status === "confirmed"
          ? "accepted"
          : ((a.status as string) === "assigned" ? "assigned" : null)) as any,
        contractId: null,
        contractStatus: null,
        invoiceId: null,
        serviceConfirmation: !!a.serviceConfirmation,
      };
    });
  });

  const confirmed = rows.filter((r) => r.billing === "confirmed");
  const accepted = rows.filter(
    (r) =>
      r.billing === "accepted" ||
      (r.billing as string) === "assigned" ||
      !r.billing,
  );
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

  const { renderOrderRequestPdf } = await import("@/lib/pdf/order-request");

  const createdDate = orders[0].createdAt
    ? new Intl.DateTimeFormat("de-DE", {
        dateStyle: "medium",
        timeZone: "Europe/Berlin",
      }).format(orders[0].createdAt)
    : "unbekannt";

  const firstDate = formatDateDE(orders[0].shiftDate);
  const lastDate = formatDateDE(orders[orders.length - 1].shiftDate);
  const dateRange =
    firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`;

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

  const targetRecipients =
    recipients && recipients.length > 0 ? recipients : [client.userId];

  const qualName =
    qualLabel[orders[0].requiredQualification as keyof typeof qualLabel] ||
    orders[0].requiredQualification;

  const subject = `Einsatzübersicht / Dienstplan – ${facilityName} (${dateRange})`;

  const textBody = `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie den aktuellen Dienstplan und die Einsatzübersicht der zugewiesenen Fachkräfte für Ihre Einrichtung (${facilityName}) im Zeitraum ${dateRange}.\n\nÜbersicht:\n- Zeitraum: ${dateRange}\n- Anzahl Schichten: ${orders.length}\n- Qualifikation: ${qualName}\n- Geplante Gesamtstunden: ${totals.totalHours.toFixed(2).replace(".", ",")} Std.\n\nDie vollständigen Details zu den eingesetzten Mitarbeitern und Schichtzeiten finden Sie im beigefügten PDF-Dokument.\n\nBei Rückfragen stehen wir Ihnen jederzeit gern zur Verfügung.\n\nMit freundlichen Grüßen,\nIhr Team der RheinAhr Dienstleistungen GmbH`;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px;">
      <h2 style="color: #0f172a; margin-bottom: 6px; font-size: 20px;">Einsatzübersicht &amp; Dienstplan</h2>
      <p style="margin-top: 0; color: #64748b; font-size: 14px;"><strong>Einrichtung:</strong> ${facilityName} | <strong>Zeitraum:</strong> ${dateRange}</p>
      
      <p>Sehr geehrte Damen und Herren,</p>
      
      <p>anbei erhalten Sie die detaillierte Einsatzübersicht mit den zugewiesenen Fachkräften und den bestätigten Schichtzeiten für Ihre Einrichtung im PDF-Format.</p>
      
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h4 style="margin: 0 0 10px 0; color: #334155; font-size: 14px;">Zusammenfassung des Auftrags:</h4>
        <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #475569;">
          <li><strong>Zeitraum:</strong> ${dateRange}</li>
          <li><strong>Anzahl Schichten:</strong> ${orders.length}</li>
          <li><strong>Qualifikation:</strong> ${qualName}</li>
          <li><strong>Geplante Gesamtstunden:</strong> ${totals.totalHours.toFixed(2).replace(".", ",")} Std.</li>
        </ul>
      </div>
      
      <p>Die detaillierte Aufstellung aller Schichten und eingesetzten Mitarbeiter entnehmen Sie bitte dem beigefügten Dokument.</p>
      
      <p>Bei Fragen oder Abstimmungsbedarf stehen wir Ihnen jederzeit gerne zur Seite.</p>
      
      <p style="margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
        Mit freundlichen Grüßen,<br>
        <strong>Ihr Team der RheinAhr Dienstleistungen GmbH</strong>
      </p>
    </div>
  `;

  const safeFacility = facilityName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `Dienstplan_${safeFacility}_${firstDate.replace(/\./g, "-")}.pdf`;

  await sendEmailToRecipients(targetRecipients, {
    subject,
    body: textBody,
    html: htmlBody,
    attachments: [
      {
        filename,
        content: Buffer.from(pdf),
        contentType: "application/pdf",
      },
    ],
  });

  await audit({
    userId: user.id,
    action: "order_request.email_sent",
    entity: "OrderGroup",
    entityId: requestGroupId,
    metadata: { recipientCount: targetRecipients.length, shiftsCount: orders.length },
  });

  return { ok: true };
}
