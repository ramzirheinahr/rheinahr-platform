"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { headers } from "next/headers";

export async function fetchClientContracts() {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") throw new Error("forbidden");

  const client = await prisma.client.findUnique({ where: { userId: user.id } });
  if (!client) throw new Error("client_not_found");

  const contracts = await prisma.clientContract.findMany({
    where: { clientId: client.id },
    include: {
      assignments: {
        include: {
          worker: true,
          order: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return contracts;
}

export async function signContract(contractId: string, signatureData?: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") throw new Error("forbidden");

  const contract = await prisma.clientContract.findUnique({
    where: { id: contractId },
    include: { client: true }
  });

  if (!contract || contract.client.userId !== user.id) {
    throw new Error("forbidden");
  }

  if (contract.status === "signed") {
    throw new Error("already_signed");
  }

  const h = await headers();
  const ipAddress = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

  await prisma.clientContract.update({
    where: { id: contractId },
    data: {
      status: "signed",
      signatureData: signatureData ?? null,
      signedAt: new Date(),
      ipAddress
    }
  });

  await audit({
    userId: user.id,
    action: "contract.sign",
    entity: "ClientContract",
    entityId: contractId,
    ipAddress
  });

  // Notify admins
  const admins = await prisma.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, active: true },
    select: { id: true }
  });

  if (admins.length > 0) {
    await prisma.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        type: "contract_signed",
        channel: "in_app",
        content: `Contract for ${contract.client.facilityName} (${contract.period}) has been signed.`,
        link: "/admin/contracts"
      }))
    });
  }

  revalidatePath("/", "layout"); // Revalidate broadly to update UI
  return { ok: true };
}
