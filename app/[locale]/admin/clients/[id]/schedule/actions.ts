"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildShiftHtmlTable } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";

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

  const periodLabel = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(startDate);

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
