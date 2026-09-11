import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { netShiftHours } from "@/lib/pricing";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
      return NextResponse.json({ ok: false, error: "Schichten nicht gefunden." }, { status: 404 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Determine contentType
    let contentType = file.type;
    if (!contentType || contentType === "application/octet-stream") {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "pdf") contentType = "application/pdf";
      else if (ext === "png") contentType = "image/png";
      else if (ext === "jpg" || ext === "jpeg") contentType = "image/jpeg";
      else contentType = "application/pdf";
    }

    const cleanFilename = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const path = `signed-confirmations/${requestGroupId}/${Date.now()}-${cleanFilename}`;
    const supabase = createSupabaseAdminClient();

    const { error: uploadError } = await supabase.storage
      .from("confirmations")
      .upload(path, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error("Supabase confirmation upload error:", uploadError);
      return NextResponse.json({ ok: false, error: `Upload-Fehler: ${uploadError.message}` }, { status: 500 });
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
              signerName,
              clientNotes,
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
    return NextResponse.json({ ok: true, count: assignments.length });
  } catch (error: any) {
    console.error("Critical error in upload-signed route:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Unerwarteter Fehler beim Hochladen." },
      { status: 500 }
    );
  }
}
