"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";

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
    select: { id: true }
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
      link: "/client/inbox"
    }
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
