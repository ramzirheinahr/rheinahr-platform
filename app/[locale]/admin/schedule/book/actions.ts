"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { z } from "zod";
import { orderLink, workerShiftLink, buildShiftHtmlTable, getFacilityClientUserIds } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";
import { formatDateDE } from "@/lib/utils";
import { getCertificatesForWorkers } from "@/app/[locale]/worker/assignments/actions";
import { formatWorkerSalutation, formatWorkerDisplayName, formatWorkerEmailIntro, formatWorkerBirthDate } from "@/lib/worker-utils";

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) throw new Error("forbidden");
  return user;
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function saveDailyNote(
  dateStr: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  if (!dateSchema.safeParse(dateStr).success) {
    return { ok: false, error: "invalid_date" };
  }

  const key = `daily_note_${dateStr}`;
  const trimmed = note.trim();

  try {
    if (trimmed.length === 0) {
      await prisma.systemSetting.deleteMany({
        where: { key },
      });
    } else {
      await prisma.systemSetting.upsert({
        where: { key },
        update: { value: trimmed },
        create: { key, value: trimmed },
      });
    }

    await audit({
      userId: admin.id,
      action: "dailyNote.save",
      entity: "SystemSetting",
      entityId: key,
      metadata: { date: dateStr, noteLength: trimmed.length },
    });

    revalidatePath("/admin/schedule/book");
    return { ok: true };
  } catch (err) {
    console.error("Failed to save daily note:", err);
    return { ok: false, error: "save_failed" };
  }
}

export async function acceptAssignmentOnBehalfOfWorker(
  assignmentId: string
): Promise<{ ok: boolean; error?: string }> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      worker: {
        select: {
          id: true,
          userId: true,
          fullName: true,
          salutation: true,
          birthDate: true,
          bio: true,
          qualification: true,
          skills: true,
          yearsExperience: true,
        },
      },
      order: {
        select: {
          id: true,
          clientId: true,
          requestGroupId: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          requiredQualification: true,
          notes: true,
          quantity: true,
          status: true,
          client: {
            select: {
              id: true,
              userId: true,
              facilityName: true,
            },
          },
        },
      },
    },
  });
  if (!assignment) return { ok: false, error: "not_found" };

  let withdrawnUserIds: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      await tx.assignment.update({
        where: { id: assignmentId },
        data: {
          status: "confirmed",
          confirmedAt: new Date(),
          cancelRequested: false,
          cancelNote: null,
          cancelRequestedAt: null,
        },
      });

      if (["pending", "review", "availability_check", "assigned"].includes(assignment.order.status)) {
        await tx.order.update({
          where: { id: assignment.order.id },
          data: { status: "accepted" },
        });
      }

      const clientUserIds = await getFacilityClientUserIds(assignment.order.client.id);
      const admins = await tx.user.findMany({
        where: { role: { in: ["admin", "super_admin"] }, active: true },
        select: { id: true, role: true },
      });

      const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
      const label = `${assignment.order.shiftDate.toISOString().slice(0, 10)} ${assignment.order.startTime}–${assignment.order.endTime}`;

      const inAppRecipients = [
        ...clientUserIds.map((id) => ({ id, role: "client" as const })),
        ...admins.map((a) => ({ id: a.id, role: a.role as "admin" | "super_admin" })),
      ];

      if (inAppRecipients.length) {
        await tx.notification.createMany({
          data: inAppRecipients.map((r) => ({
            userId: r.id,
            type: "worker_confirmed" as const,
            channel: "in_app" as const,
            content: `${assignment.worker.fullName}: ${label}`,
            link: orderLink(r.role, reqGroup),
          })),
        });
      }

      const staffing = await tx.order.findUnique({
        where: { id: assignment.order.id },
        select: {
          quantity: true,
          _count: { select: { assignments: { where: { status: "confirmed" } } } },
        },
      });

      if (staffing && staffing._count.assignments >= staffing.quantity) {
        const stillPending = await tx.assignment.findMany({
          where: {
            orderId: assignment.order.id,
            status: "pending",
            NOT: { id: assignmentId },
          },
          select: { id: true, worker: { select: { userId: true } } },
        });
        if (stillPending.length) {
          await tx.assignment.deleteMany({
            where: { id: { in: stillPending.map((a) => a.id) } },
          });
          withdrawnUserIds = stillPending.map((a) => a.worker.userId);
          await tx.notification.createMany({
            data: withdrawnUserIds.map((uid) => ({
              userId: uid,
              type: "order_status_changed" as const,
              channel: "in_app" as const,
              content: `Einsatz bereits besetzt: ${label}`,
              link: workerShiftLink(),
            })),
          });
        }
      }
    });

    await audit({
      userId: admin.id,
      action: "assignment.accept_on_behalf",
      entity: "Assignment",
      entityId: assignmentId,
      metadata: {
        workerId: assignment.worker.id,
        workerName: assignment.worker.fullName,
        orderId: assignment.order.id,
      },
    });

    // Send confirmation email to client and notifications
    const body = `${assignment.worker.fullName}: ${formatDateDE(assignment.order.shiftDate)} ${assignment.order.startTime}–${assignment.order.endTime}`;
    const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;

    const shiftData = {
      date: assignment.order.shiftDate,
      startTime: assignment.order.startTime,
      endTime: assignment.order.endTime,
      qualification: assignment.order.requiredQualification,
      notes: assignment.order.notes || undefined,
      facilityName: assignment.order.client.facilityName,
      workerName: assignment.worker.fullName,
      workerSalutation: assignment.worker.salutation,
      workerBirthDate: assignment.worker.birthDate,
    };
    const shiftHtml = buildShiftHtmlTable([shiftData]);

    const salutationLabel = formatWorkerSalutation(assignment.worker.salutation);
    const birthDateStr = formatWorkerBirthDate(assignment.worker.birthDate);
    const workerIntro = formatWorkerEmailIntro(assignment.worker);

    const workerProfile = `
      <div style="margin-top: 20px; padding: 15px; background-color: #f9fafb; border: 1px solid #e2e8f0; border-radius: 6px;">
        <h3 style="margin-top: 0; margin-bottom: 12px; color: #0f172a; font-size: 15px;">Mitarbeiterprofil</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #334155;">
          ${salutationLabel ? `<tr><td style="padding: 4px 0; width: 130px; color: #64748b;"><strong>Anrede:</strong></td><td style="padding: 4px 0;">${salutationLabel}</td></tr>` : ""}
          <tr><td style="padding: 4px 0; width: 130px; color: #64748b;"><strong>Name:</strong></td><td style="padding: 4px 0; font-weight: 600;">${assignment.worker.fullName}</td></tr>
          ${birthDateStr ? `<tr><td style="padding: 4px 0; width: 130px; color: #64748b;"><strong>Geburtsdatum:</strong></td><td style="padding: 4px 0;">${birthDateStr}</td></tr>` : ""}
          <tr><td style="padding: 4px 0; width: 130px; color: #64748b;"><strong>Qualifikation:</strong></td><td style="padding: 4px 0;">${assignment.worker.qualification}</td></tr>
          ${assignment.worker.yearsExperience ? `<tr><td style="padding: 4px 0; width: 130px; color: #64748b;"><strong>Erfahrung:</strong></td><td style="padding: 4px 0;">${assignment.worker.yearsExperience} Jahre</td></tr>` : ""}
          ${assignment.worker.skills.length > 0 ? `<tr><td style="padding: 4px 0; width: 130px; color: #64748b;"><strong>Fähigkeiten:</strong></td><td style="padding: 4px 0;">${assignment.worker.skills.join(", ")}</td></tr>` : ""}
          ${assignment.worker.bio ? `<tr><td style="padding: 4px 0; width: 130px; color: #64748b;"><strong>Über mich:</strong></td><td style="padding: 4px 0;">${assignment.worker.bio}</td></tr>` : ""}
        </table>
      </div>
    `;

    const clientHtml = `
      <p>Sehr geehrte Damen und Herren,</p>
      <p>wir freuen uns, Ihnen mitteilen zu können, dass der folgende Einsatz von ${workerIntro} bestätigt wurde:</p>
      ${shiftHtml}
      ${workerProfile}
      <p>Unser Mitarbeiter wird pünktlich zum Dienstbeginn bei Ihnen vor Ort sein.</p>
    `;

    const adminHtml = `
      <p>Der Mitarbeiter <strong>${assignment.worker.fullName}</strong> wurde für den folgenden Einsatz bestätigt:</p>
      ${shiftHtml}
    `;

    const workerHtml = `
      <p>Hallo <strong>${assignment.worker.fullName}</strong>,</p>
      <p>Sie sind für folgenden Einsatz fest eingeplant:</p>
      ${shiftHtml}
      <p>Wir verlassen uns auf Sie. Bitte seien Sie pünktlich vor Ort.</p>
    `;

    const clientUserIds = await getFacilityClientUserIds(assignment.order.client.id);
    const attachments = await getCertificatesForWorkers([assignment.worker.id]);

    const staffAdmins = await prisma.user.findMany({
      where: { role: { in: ["admin", "super_admin"] }, active: true },
      select: { id: true },
    });

    await Promise.all([
      clientUserIds.length > 0
        ? pushToUsers(clientUserIds, {
            title: "Einsatz bestätigt",
            body,
            url: orderLink("client", reqGroup),
            htmlBody: clientHtml,
            attachments,
            forceEmail: true,
          })
        : Promise.resolve(),
      pushToUsers(
        staffAdmins.map((a) => a.id),
        { title: "Einsatz bestätigt", body, url: orderLink("admin", reqGroup), htmlBody: adminHtml, skipEmail: true },
      ),
      pushToUsers(
        [assignment.worker.userId],
        { title: "Einsatz bestätigt", body, url: workerShiftLink(), htmlBody: workerHtml, skipEmail: true },
      ),
      withdrawnUserIds.length > 0
        ? pushToUsers(withdrawnUserIds, {
            title: "Einsatz bereits besetzt",
            body: `${formatDateDE(assignment.order.shiftDate)} ${assignment.order.startTime}–${assignment.order.endTime}`,
            url: workerShiftLink(),
            skipEmail: true,
          })
        : Promise.resolve(),
    ]).catch((err) => console.error("Error dispatching notifications:", err));

    revalidatePath("/admin/schedule");
    revalidatePath("/admin/schedule/book");
    revalidatePath(`/admin/workers/${assignment.worker.id}/schedule`);
    revalidatePath("/worker");

    return { ok: true };
  } catch (err) {
    console.error("Failed to accept assignment on behalf of worker:", err);
    return { ok: false, error: "save_failed" };
  }
}

export async function replaceWorkerOnAssignment(
  assignmentId: string,
  newWorkerId: string,
  force = false
): Promise<{ ok: boolean; error?: string }> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const existing = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { order: true },
  });
  if (!existing) return { ok: false, error: "not_found" };

  const { unassignFromGrid, assignWorkerToOrder } = await import(
    "@/app/[locale]/admin/schedule/actions"
  );

  const unassignRes = await unassignFromGrid(assignmentId);
  if (!unassignRes.ok) return unassignRes;

  const assignRes = await assignWorkerToOrder(existing.orderId, newWorkerId, force);
  return assignRes;
}
