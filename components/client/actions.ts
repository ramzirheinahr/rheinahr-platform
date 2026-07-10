"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function signContract(contractId: string, signatureData: string) {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["client"])) {
    throw new Error("unauthorized");
  }

  const contract = await prisma.clientContract.findUnique({
    where: { id: contractId },
    include: { client: true }
  });

  if (!contract) throw new Error("not_found");
  if (contract.client.userId !== user.id) throw new Error("forbidden");
  if (contract.status !== "pending") throw new Error("already_signed");

  // In text-based signature, the signatureData is just the confirmation string
  await prisma.clientContract.update({
    where: { id: contractId },
    data: {
      status: "signed",
      signedAt: new Date(),
    }
  });

  await audit({
    userId: user.id,
    action: "contract.sign",
    entity: "ClientContract",
    entityId: contractId,
    metadata: { method: "text" }
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
