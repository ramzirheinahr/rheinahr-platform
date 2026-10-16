import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { netShiftHours } from "@/lib/pricing";
import { createLocalStorageClient } from "@/lib/local-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !roleSatisfies(user.role, ["admin"])) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const formData = await req.formData();
    const assignmentIdsStr = formData.get("assignmentIds") as string;
    const file = formData.get("document") as File | null;
    const signerName = (formData.get("signerName") as string)?.trim() || "Manuell signiert";
    const clientNotes = (formData.get("clientNotes") as string)?.trim() || "Manuell signierter Leistungsnachweis";
    const requestGroupId = (formData.get("requestGroupId") as string)?.trim() || "general";
    const proposedHoursRaw = formData.get("proposedHours");

    let explicitProposedHours: number | undefined;
    if (proposedHoursRaw !== null && proposedHoursRaw !== undefined && String(proposedHoursRaw).trim() !== "") {
      const { validateAndNormalizeProposedHours } = await import("@/lib/confirmation-evidence-service");
      try {
        explicitProposedHours = validateAndNormalizeProposedHours(proposedHoursRaw);
      } catch (validationErr) {
        const msg = validationErr instanceof Error ? validationErr.message : "Ungültiger Stundenwert.";
        return NextResponse.json({ ok: false, error: msg }, { status: 400 });
      }
    }
    const hasValidProposedHours = explicitProposedHours !== undefined;

    if (!assignmentIdsStr || !file || typeof file !== "object" || !("size" in file) || file.size === 0) {
      return NextResponse.json({ ok: false, error: "Bitte wählen Sie eine Datei aus." }, { status: 400 });
    }

    let assignmentIds: string[];
    try {
      assignmentIds = JSON.parse(assignmentIdsStr);
    } catch {
      return NextResponse.json({ ok: false, error: "Ungültige Schichten-Auswahl." }, { status: 400 });
    }

    if (!assignmentIds.length) {
      return NextResponse.json({ ok: false, error: "Keine Schichten ausgewählt." }, { status: 400 });
    }

    // Strict validation: ALL requested assignments must exist, and belong to the correct scope
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
            method: true,
            hoursWorked: true,
            signatureData: true,
            signerName: true,
            confirmedAt: true,
          },
        },
      },
    });

    if (assignments.length !== assignmentIds.length) {
      return NextResponse.json(
        { ok: false, error: "Eine oder mehrere ausgewählte Schichten wurden nicht gefunden." },
        { status: 400 }
      );
    }

    // Ensure all assignments belong to the same client/facility
    const firstClientId = assignments[0].order.clientId;
    if (assignments.some((a) => a.order.clientId !== firstClientId)) {
      return NextResponse.json(
        { ok: false, error: "Schichten gehören zu unterschiedlichen Kunden." },
        { status: 400 }
      );
    }

    const cleanGroupId = requestGroupId.replace(/[^a-zA-Z0-9.-]/g, "_") || "general";

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (buffer.length > 25 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "Datei ist zu groß (max. 25 MB)." }, { status: 400 });
    }

    const { detectMimeTypeFromBuffer } = await import("@/lib/confirmation-tickets");
    const detectedMime = detectMimeTypeFromBuffer(buffer);
    if (!detectedMime) {
      return NextResponse.json(
        { ok: false, error: "Ungültiger oder nicht unterstützter Dateiinhalt. Erlaubt sind echte PDF-, PNG-, JPEG- oder WebP-Dateien." },
        { status: 400 }
      );
    }
    const contentType = detectedMime;

    const crypto = await import("node:crypto");
    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

    // Check duplicate file hash across selected assignments before upload
    const existingDoc = await prisma.confirmationDocument.findFirst({
      where: {
        assignmentId: { in: assignmentIds },
        fileHash,
      },
    });
    if (existingDoc) {
      return NextResponse.json(
        { ok: false, error: "Dieses Dokument wurde für eine dieser Schichten bereits hochgeladen." },
        { status: 409 }
      );
    }

    const randomSlug = crypto.randomBytes(8).toString("hex");
    const cleanFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const path = `signed-confirmations/${cleanGroupId}/${Date.now()}-${randomSlug}-${cleanFilename}`;
    const supabase = createLocalStorageClient();

    const { error: uploadError } = await supabase.storage
      .from("confirmations")
      .upload(path, buffer, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Confirmation storage upload error:", uploadError);
      return NextResponse.json({ ok: false, error: `Upload-Fehler: ${uploadError.message}` }, { status: 500 });
    }

    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const now = new Date();

    try {
      await prisma.$transaction(async (tx) => {
        for (const a of assignments) {
          const scheduledHours = netShiftHours(
            a.order.startTime,
            a.order.endTime,
            a.order.breakMinutes,
          );

          const hasExisting = Boolean(a.serviceConfirmation);
          const sourceType = hasExisting ? "manual_correction" : "manual_upload";

          // 1. Add immutable evidence document entry
          const doc = await tx.confirmationDocument.create({
            data: {
              assignmentId: a.id,
              sourceType,
              storagePath: path,
              fileHash,
              fileName: cleanFilename,
              mimeType: contentType,
              fileSizeBytes: buffer.length,
              signerName,
              signerIp: ip,
              uploadedById: user.id,
              uploaderRole: "admin",
              metadata: { clientNotes, requestGroupId },
              createdAt: now,
            },
          });

          // 2. Safe ServiceConfirmation handling
          if (a.serviceConfirmation) {
            // Existing confirmation (electronic or manual): NEVER overwrite approved hoursWorked,
            // method, signatureData, confirmedAt, or signerName.
            // NEVER infer hours from scheduledHours! Only create correction if admin explicitly supplied valid proposedHours:
            if (
              hasValidProposedHours &&
              Number(a.serviceConfirmation.hoursWorked) !== explicitProposedHours
            ) {
              await tx.workHoursCorrectionRequest.create({
                data: {
                  assignmentId: a.id,
                  documentId: doc.id,
                  status: "proposed",
                  previousHoursWorked: a.serviceConfirmation.hoursWorked,
                  proposedHoursWorked: explicitProposedHours!,
                  reason: clientNotes || "Manuell eingereichte Stundenkorrektur",
                  requestedById: user.id,
                  requestedAt: now,
                },
              });
            }
          } else {
            // Initial manual confirmation: create initial ServiceConfirmation
            const initialHours = hasValidProposedHours ? explicitProposedHours : scheduledHours;
            await tx.serviceConfirmation.create({
              data: {
                assignmentId: a.id,
                confirmedById: user.id,
                method: "upload",
                documentUrl: path,
                hoursWorked: initialHours,
                signerName,
                clientNotes,
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
    } catch (txError: unknown) {
      const { error: removeErr } = await supabase.storage.from("confirmations").remove([path]);
      if (removeErr) {
        console.error("Failed to clean up storage file after DB failure in upload-signed route:", removeErr);
      }
      const errorCode = (txError as { code?: string })?.code;
      const errorMsg = txError instanceof Error ? txError.message : String(txError);
      const meta = (txError as { meta?: { target?: string[] | string } })?.meta;
      const isDocUnique =
        (errorCode === "P2002" && (
          Array.isArray(meta?.target)
            ? meta.target.includes("fileHash") || meta.target.includes("file_hash")
            : typeof meta?.target === "string"
              ? meta.target.includes("file_hash") || meta.target.includes("fileHash") || meta.target.includes("confirmation_documents")
              : false
        )) ||
        errorMsg.includes("confirmation_documents_assignment_id_file_hash_key") ||
        errorMsg.includes("(`assignment_id`,`file_hash`)");

      if (isDocUnique) {
        return NextResponse.json(
          { ok: false, error: "Dieses Dokument wurde für eine der Schichten bereits hochgeladen." },
          { status: 409 }
        );
      }
      throw txError;
    }

    try {
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
    } catch (postCommitErr) {
      console.warn("Post-commit audit/revalidate failed in upload-signed route:", postCommitErr);
    }

    return NextResponse.json({ ok: true, count: assignments.length });
  } catch (error: unknown) {
    console.error("Critical error in upload-signed route:", error);
    const message = error instanceof Error ? error.message : "Unerwarteter Fehler beim Hochladen.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
