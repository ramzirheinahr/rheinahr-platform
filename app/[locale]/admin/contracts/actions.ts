"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function fetchUncontractedAssignments(clientId: string) {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) throw new Error("forbidden");

  const assignments = await prisma.assignment.findMany({
    where: {
      order: { 
        clientId,
        shiftDate: { gte: new Date() }
      },
      contractId: null,
      status: "confirmed"
    },
    include: {
      worker: true,
      order: true
    },
    orderBy: {
      order: { shiftDate: "asc" }
    }
  });
  return assignments;
}

export async function generateContract(clientId: string, assignmentIds: string[], period: string) {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) throw new Error("forbidden");

  if (!assignmentIds.length) throw new Error("no_assignments");

  // Create contract and link it to the selected assignments
  const contract = await prisma.clientContract.create({
    data: {
      clientId,
      period,
      status: "pending",
      assignments: {
        connect: assignmentIds.map(id => ({ id }))
      }
    },
    include: { client: true }
  });

  await prisma.notification.create({
    data: {
      userId: contract.client.userId,
      type: "contract_pending",
      channel: "in_app",
      content: `A new contract for ${period} is ready to be signed.`,
      link: "/client/contracts"
    }
  });

  await audit({
    userId: user.id,
    action: "contract.generate",
    entity: "ClientContract",
    entityId: contract.id,
    metadata: { assignmentCount: assignmentIds.length }
  });

  revalidatePath("/", "layout"); // Revalidate broadly to update UI
  return { ok: true, contractId: contract.id };
}
