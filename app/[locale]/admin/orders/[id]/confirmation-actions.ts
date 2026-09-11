"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { netShiftHours } from "@/lib/pricing";

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

function normalizeMimeType(fileName: string, mimeType?: string): string {
  let type = mimeType?.toLowerCase().split(";")[0]?.trim();
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (!type || type === "application/octet-stream") {
    if (ext === "pdf") return "application/pdf";
    if (ext === "png") return "image/png";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "webp") return "image/webp";
  }
  if (type === "image/jpg") return "image/jpeg";
  return type || "application/pdf";
}

export type UploadTicket =
  | { ok: true; path: string; token: string }
  | { ok: false; error: string };

/**
 * Step 1: Generate a signed upload URL for the file to upload directly to Supabase Storage.
 * This completely bypasses all serverless body size limits (e.g. Vercel 4.5MB limit).
 */
export async function createConfirmationUploadTicket({
  requestGroupId,
  fileName,
  fileType,
  fileSize,
}: {
  requestGroupId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}): Promise<UploadTicket> {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    return { ok: false, error: "forbidden" };
  }
  if (!fileSize || fileSize <= 0) {
    return { ok: false, error: "Bitte eine Datei auswählen." };
  }
  if (fileSize > 25 * 1024 * 1024) {
    return { ok: false, error: "Datei ist zu groß (max. 25 MB)." };
  }

  const cleanFilename = safeName(fileName);
  const path = `signed-confirmations/${requestGroupId}/${Date.now()}-${cleanFilename}`;
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.storage
    .from("confirmations")
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("Failed to create signed upload url:", error);
    return { ok: false, error: "Fehler beim Vorbereiten des Uploads." };
  }

  return { ok: true, path: data.path, token: data.token };
}

/**
 * Step 2: Finalize the confirmation records once the file is in Supabase storage.
 */
export async function finalizeDirectSignedConfirmation({
  assignmentIds,
  path,
  signerName = "Manuell signiert",
  clientNotes = "Manuell signierter Leistungsnachweis",
  requestGroupId = "general",
}: {
  assignmentIds: string[];
  path: string;
  signerName?: string;
  clientNotes?: string;
  requestGroupId?: string;
}): Promise<{ ok: boolean; count?: number; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    return { ok: false, error: "forbidden" };
  }

  if (!assignmentIds || !assignmentIds.length) {
    return { ok: false, error: "Keine Schichten ausgewählt." };
  }

  try {
    const assignments = await prisma.assignment.findMany({
      where: {
        id: { in: assignmentIds },
      },
      include: {
        order: {
          select: {
            id: true,
            shiftDate: true,
            startTime: true,
            endTime: true,
            breakMinutes: true,
            clientId: true,
            requestGroupId: true,
            client: {
              select: {
                userId: true,
                facilityName: true,
              },
            },
          },
        },
        worker: {
          select: {
            id: true,
            userId: true,
            fullName: true,
          },
        },
        serviceConfirmation: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!assignments.length) {
      return { ok: false, error: "Schichten nicht gefunden." };
    }

    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      for (const a of assignments) {
        const scheduledHours = netShiftHours(
          a.order.startTime,
          a.order.endTime,
          a.order.breakMinutes,
        );

        if (a.serviceConfirmation) {
          await tx.serviceConfirmation.update({
            where: { id: a.serviceConfirmation.id },
            data: {
              confirmedById: user.id,
              method: "upload",
              documentUrl: path,
              hoursWorked: scheduledHours,
              signerName: signerName.trim() || "Manuell signiert",
              clientNotes: clientNotes.trim() || "Manuell signierter Leistungsnachweis",
              ipAddress: ip,
              confirmedAt: now,
            },
          });
        } else {
          await tx.serviceConfirmation.create({
            data: {
              assignmentId: a.id,
              confirmedById: user.id,
              method: "upload",
              documentUrl: path,
              hoursWorked: scheduledHours,
              signerName: signerName.trim() || "Manuell signiert",
              clientNotes: clientNotes.trim() || "Manuell signierter Leistungsnachweis",
              ipAddress: ip,
              confirmedAt: now,
            },
          });
        }
      }

      const orderIds = Array.from(new Set(assignments.map((a) => a.order.id)));
      for (const orderId of orderIds) {
        const remainingUnconfirmed = await tx.assignment.count({
          where: {
            orderId,
            status: "confirmed",
            serviceConfirmation: { is: null },
          },
        });

        if (remainingUnconfirmed === 0) {
          await tx.order.update({
            where: { id: orderId },
            data: { status: "confirmed" },
          });
        }
      }

      const workerUserIds = Array.from(
        new Set(
          assignments
            .map((a) => a.worker?.userId)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      if (workerUserIds.length > 0) {
        const firstOrder = assignments[0].order;
        await tx.notification.createMany({
          data: workerUserIds.map((wUserId) => ({
            userId: wUserId,
            type: "service_confirmed" as const,
            channel: "in_app" as const,
            content: `${firstOrder.client.facilityName} · Leistungsnachweis bestätigt (${assignments.length} Schicht(en))`,
            link: "/worker",
          })),
        });
      }
    });

    await audit({
      userId: user.id,
      action: "service_confirmation.bulk_upload",
      entity: "OrderGroup",
      entityId: requestGroupId,
      ipAddress: ip,
      metadata: {
        assignmentCount: assignments.length,
        documentPath: path,
        signerName,
      },
    });

    revalidatePath("/", "layout");
    return { ok: true, count: assignments.length };
  } catch (error: any) {
    console.error("Critical error in finalizeDirectSignedConfirmation:", error);
    return { ok: false, error: error?.message || "Fehler beim Speichern der Bestätigungen." };
  }
}

/**
 * Fallback server action for direct FormData upload.
 */
export async function uploadDirectSignedConfirmation(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    return { ok: false, error: "forbidden" };
  }

  try {
    const assignmentIdsStr = formData.get("assignmentIds") as string;
    const file = formData.get("document") as File | null;
    const signerName = (formData.get("signerName") as string)?.trim() || "Manuell signiert";
    const clientNotes = (formData.get("clientNotes") as string)?.trim() || "Manuell signierter Leistungsnachweis";
    const requestGroupId = (formData.get("requestGroupId") as string)?.trim() || "general";

    if (!assignmentIdsStr || !file || typeof file !== "object" || !("size" in file) || file.size === 0) {
      return { ok: false, error: "Bitte wählen Sie eine Datei aus." };
    }

    let assignmentIds: string[];
    try {
      assignmentIds = JSON.parse(assignmentIdsStr);
    } catch {
      return { ok: false, error: "Ungültige Schichten-Auswahl." };
    }

    if (!assignmentIds.length) {
      return { ok: false, error: "Keine Schichten ausgewählt." };
    }

    const cleanFilename = safeName(file.name);
    const path = `signed-confirmations/${requestGroupId}/${Date.now()}-${cleanFilename}`;
    const contentType = normalizeMimeType(file.name, file.type);
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createSupabaseAdminClient();

    const { error: uploadError } = await supabase.storage
      .from("confirmations")
      .upload(path, await file.arrayBuffer(), {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error("Supabase confirmation upload error:", uploadError);
      return { ok: false, error: `Upload-Fehler: ${uploadError.message}` };
    }

    return await finalizeDirectSignedConfirmation({
      assignmentIds,
      path,
      signerName,
      clientNotes,
      requestGroupId,
    });
  } catch (error: any) {
    console.error("Critical error in uploadDirectSignedConfirmation:", error);
    return { ok: false, error: error?.message || "Unerwarteter Fehler beim Hochladen." };
  }
}
