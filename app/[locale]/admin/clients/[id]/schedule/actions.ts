"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildShiftHtmlTable } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";
import { sendEmailToRecipients } from "@/lib/email";

export async function generateMonthContracts(clientId: string, year: number, month: number) {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) throw new Error("forbidden");

  // Find all uncontracted shifts in this month
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));

  const assignments = await prisma.assignment.findMany({
    where: {
      order: { 
        clientId,
        shiftDate: { gte: startDate, lt: endDate }
      },
      contractId: null,
      status: "confirmed" // Or completed. Usually we want confirmed or completed. Wait, confirmed is fine.
    },
    select: { 
      id: true,
      worker: { select: { fullName: true, qualification: true } },
      order: { 
        select: { 
          shiftDate: true, 
          startTime: true, 
          endTime: true, 
          notes: true, 
          requiredQualification: true,
          client: { select: { facilityName: true } } 
        } 
      }
    }
  });

  if (!assignments.length) {
    throw new Error("Keine offenen Schichten für diesen Monat gefunden.");
  }

  const periodLabel = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "Europe/Berlin" }).format(startDate);

  // Create contract
  const contract = await prisma.clientContract.create({
    data: {
      clientId,
      period: periodLabel,
      status: "pending",
      assignments: {
        connect: assignments.map(a => ({ id: a.id }))
      }
    },
    include: { client: true }
  });

  await prisma.notification.create({
    data: {
      userId: contract.client.userId,
      type: "contract_pending",
      channel: "in_app",
      content: `Ein neuer AÜV für ${periodLabel} steht zur Signatur bereit.`,
      link: `/client/schedule?year=${year}&month=${month}`
    }
  });

  const contractHtml = `
    <p>Ein neuer Arbeitnehmerüberlassungsvertrag (AÜV) für <strong>${periodLabel}</strong> wurde erstellt und steht zur Signatur bereit.</p>
    <p>Folgende Einsätze sind Bestandteil dieses Vertrags:</p>
    ${buildShiftHtmlTable(assignments.map(a => ({
      date: a.order.shiftDate,
      startTime: a.order.startTime,
      endTime: a.order.endTime,
      qualification: a.worker.qualification,
      notes: a.order.notes || undefined,
      facilityName: a.order.client.facilityName,
      workerName: a.worker.fullName,
    })))}
    <p>Bitte prüfen und unterzeichnen Sie den Vertrag in Ihrem Kundenportal.</p>
  `;

  await pushToUsers([contract.client.userId], {
    title: "Neuer Vertrag zur Signatur",
    body: `Ein neuer AÜV für ${periodLabel} steht zur Signatur bereit.`,
    url: `/client/schedule?year=${year}&month=${month}`,
    htmlBody: contractHtml,
  });

  await audit({
    userId: user.id,
    action: "contract.generate",
    entity: "ClientContract",
    entityId: contract.id,
    metadata: { assignmentCount: assignments.length, period: periodLabel }
  });

  revalidatePath("/", "layout");
  return { ok: true, contractId: contract.id };
}

export async function sendClientMonthScheduleEmail({
  clientId,
  year,
  month,
  recipients,
}: {
  clientId: string;
  year: number;
  month: number;
  recipients?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || (!roleSatisfies(user.role, ["admin"]))) {
    return { ok: false, error: "forbidden" };
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, facilityName: true, userId: true },
  });
  if (!client) return { ok: false, error: "not_found" };

  const { getClientMonthSchedule } = await import("@/lib/client-schedule");
  const { rows, totals } = await getClientMonthSchedule(client.id, year, month);

  const monthLabel = new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(Date.UTC(year, month - 1, 1)));

  const { renderMonatsuebersichtPdf } = await import("@/lib/pdf/monatsuebersicht");
  const pdf = await renderMonatsuebersichtPdf({
    facilityName: client.facilityName,
    monthLabel,
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

  const subject = `Monatsübersicht Einsätze ${monthLabel} – ${client.facilityName} – RheinAhr Dienstleistungen GmbH`;

  const textBody = `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die offizielle Monatsübersicht aller Einsätze und geleisteten Stunden für den Monat ${monthLabel} für Ihre Einrichtung (${client.facilityName}) im PDF-Format.\n\nMonatsüberblick:\n- Monat: ${monthLabel}\n- Bestätigte Stunden: ${(totals.confirmedHours ?? 0).toFixed(2).replace(".", ",")} Std. (${totals.confirmedShifts} Schichten)\n- Gesamtstunden: ${(totals.totalHours ?? 0).toFixed(2).replace(".", ",")} Std.\n\nDie detaillierte Aufstellung aller Einsatztage, Schichtzeiten und der jeweils eingesetzten Fachkräfte entnehmen Sie bitte der beigefügten PDF-Datei.\n\nFür Rückfragen stehen wir Ihnen jederzeit gerne zur Verfügung.\n\nMit freundlichen Grüßen,\nIhr Team der RheinAhr Dienstleistungen GmbH`;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px;">
      <h2 style="color: #0f172a; margin-bottom: 6px; font-size: 20px;">Monatsübersicht der Einsätze</h2>
      <p style="margin-top: 0; color: #64748b; font-size: 14px;"><strong>Einrichtung:</strong> ${client.facilityName} | <strong>Monat:</strong> ${monthLabel}</p>
      
      <p>Sehr geehrte Damen und Herren,</p>
      
      <p>anbei erhalten Sie die offizielle Monatsübersicht aller Einsätze und geleisteten Stunden für den Monat <strong>${monthLabel}</strong> für Ihre Einrichtung im PDF-Format.</p>
      
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h4 style="margin: 0 0 10px 0; color: #334155; font-size: 14px;">Monatsüberblick:</h4>
        <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #475569;">
          <li><strong>Monat:</strong> ${monthLabel}</li>
          <li><strong>Bestätigte Stunden:</strong> ${(totals.confirmedHours ?? 0).toFixed(2).replace(".", ",")} Std. (${totals.confirmedShifts} Schichten)</li>
          <li><strong>Gesamtstunden:</strong> ${(totals.totalHours ?? 0).toFixed(2).replace(".", ",")} Std.</li>
        </ul>
      </div>
      
      <p>Die detaillierte Aufstellung aller Einsatztage, Schichtzeiten und der jeweils eingesetzten Fachkräfte entnehmen Sie bitte der beigefügten PDF-Datei.</p>
      
      <p>Für Rückfragen oder Abstimmungen stehen wir Ihnen jederzeit gern zur Verfügung.</p>
      
      <p style="margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
        Mit freundlichen Grüßen,<br>
        <strong>Ihr Team der RheinAhr Dienstleistungen GmbH</strong>
      </p>
    </div>
  `;

  const safeFacility = client.facilityName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `Monatsuebersicht_${safeFacility}_${year}_${String(month).padStart(2, "0")}.pdf`;

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
    action: "client.schedule.email_sent",
    entity: "Client",
    entityId: clientId,
    metadata: { year, month, recipientCount: targetRecipients.length },
  });

  return { ok: true };
}
