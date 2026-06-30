"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { serviceConfirmationSchema } from "@/lib/validations";

export type ActionState = { ok: boolean; error?: string };

const BUCKET = "confirmations";

// The client digitally confirms a performed shift (Leistungsnachweis).
// Tamper-evident: records who, when, and the request IP (GDPR audit path).
export async function confirmService(formData: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") return { ok: false, error: "forbidden" };

  const parsed = serviceConfirmationSchema.safeParse({
    assignmentId: formData.get("assignmentId"),
    method: formData.get("method"),
    hoursWorked: formData.get("hoursWorked"),
    signatureData: formData.get("signatureData") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "saveError" };
  const data = parsed.data;

  // The assignment must belong to one of this client's orders, be worker-confirmed,
  // and not already have a service confirmation.
  const assignment = await prisma.assignment.findUnique({
    where: { id: data.assignmentId },
    include: {
      serviceConfirmation: { select: { id: true } },
      order: { select: { id: true, client: { select: { userId: true } } } },
      worker: { select: { userId: true } },
    },
  });
  if (
    !assignment ||
    assignment.order.client.userId !== user.id ||
    assignment.status !== "confirmed"
  ) {
    return { ok: false, error: "forbidden" };
  }
  if (assignment.serviceConfirmation) return { ok: false, error: "alreadyConfirmed" };

  // Method B — upload the signed scan to the private Storage bucket.
  let documentUrl: string | undefined;
  if (data.method === "upload") {
    const file = formData.get("document");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "fileRequired" };
    }
    const path = `${data.assignmentId}/${Date.now()}-${file.name}`;
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, await file.arrayBuffer(), {
        contentType: file.type,
        upsert: false,
      });
    if (error) return { ok: false, error: "saveError" };
    documentUrl = path;
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  await prisma.$transaction(async (tx) => {
    await tx.serviceConfirmation.create({
      data: {
        assignmentId: data.assignmentId,
        confirmedById: user.id,
        method: data.method,
        signatureData: data.method === "electronic" ? data.signatureData : null,
        documentUrl: documentUrl ?? null,
        hoursWorked: data.hoursWorked,
        ipAddress: ip,
      },
    });

    // Advance the order to "confirmed" once every worker-confirmed assignment
    // has a service confirmation.
    const remaining = await tx.assignment.count({
      where: {
        orderId: assignment.order.id,
        status: "confirmed",
        serviceConfirmation: { is: null },
      },
    });
    if (remaining === 0) {
      await tx.order.update({
        where: { id: assignment.order.id },
        data: { status: "confirmed" },
      });
    }

    // Notify the worker + admins (CLAUDE.md §8 "Service confirmed").
    const recipients = await tx.user.findMany({
      where: {
        OR: [
          { id: assignment.worker.userId },
          { role: { in: ["admin", "super_admin"] }, active: true },
        ],
      },
      select: { id: true },
    });
    if (recipients.length) {
      await tx.notification.createMany({
        data: recipients.map((r) => ({
          userId: r.id,
          type: "service_confirmed" as const,
          channel: "in_app" as const,
          content: `${data.hoursWorked}h`,
        })),
      });
    }
  });

  await audit({
    userId: user.id,
    action: "service.confirm",
    entity: "Assignment",
    entityId: data.assignmentId,
    ipAddress: ip,
    metadata: { method: data.method, hours: data.hoursWorked },
  });

  revalidatePath("/client/confirmations");
  revalidatePath(`/admin/orders/${assignment.order.id}`);
  return { ok: true };
}
