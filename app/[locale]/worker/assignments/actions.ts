"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runSerializable } from "@/lib/assignments";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { orderLink, inboxLink, workerShiftLink, buildShiftHtmlTable } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";
import { formatDateDE } from "@/lib/utils";

export type ActionState = { ok: boolean; error?: string };

export async function respondAssignmentsBulk(
  responses: { id: string; accept: boolean }[],
): Promise<ActionState & { processed: number; errors: number }> {
  const user = await getCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "super_admin";
  if (!user || (!isStaff && user.role !== "worker")) {
    return { ok: false, processed: 0, errors: responses.length, error: "forbidden" };
  }

  const admins = await prisma.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, active: true },
    select: { id: true },
  });

  const processedIds: string[] = [];
  let errorCount = 0;
  
  // Track successful updates to build bulk notifications
  const acceptedShifts: any[] = [];
  const declinedShifts: any[] = [];
  const clientNotifications = new Map<string, { userId: string, shifts: any[] }>();

  // We process them one by one serially so one shift being full doesn't crash the whole batch.
  for (const { id, accept } of responses) {
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        worker: { select: { userId: true, fullName: true, bio: true, qualification: true, skills: true, yearsExperience: true } },
        order: {
          select: {
            id: true,
            requestGroupId: true,
            shiftDate: true,
            startTime: true,
            endTime: true,
            requiredQualification: true,
            notes: true,
            client: { select: { userId: true, facilityName: true } },
          },
        },
      },
    });

    if (!assignment || (!isStaff && assignment.worker.userId !== user.id)) {
      errorCount++;
      continue;
    }

    let withdrawnUserIds: string[] = [];
    let success = true;

    try {
      await runSerializable(async (tx) => {
        if (accept) {
          const orderData = await tx.order.findUnique({
            where: { id: assignment.order.id },
            select: {
              quantity: true,
              _count: {
                select: {
                  assignments: {
                    where: { status: "confirmed", NOT: { id } },
                  },
                },
              },
            },
          });
          if (!orderData || orderData._count.assignments >= orderData.quantity) {
            throw new Error("shiftFull");
          }
        }

        await tx.assignment.update({
          where: { id },
          data: {
            status: accept ? "confirmed" : "declined",
            confirmedAt: accept ? new Date() : null,
            ...(accept ? { cancelRequested: false, cancelNote: null, cancelRequestedAt: null } : {}),
          },
        });

        if (accept) {
          await tx.order.update({
            where: { id: assignment.order.id },
            data: { status: "accepted" },
          });

          const recipients = await tx.user.findMany({
            where: {
              OR: [
                { id: assignment.order.client.userId },
                { role: { in: ["admin", "super_admin"] }, active: true },
              ],
            },
            select: { id: true, role: true },
          });
          
          const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
          const label = `${assignment.order.shiftDate.toISOString().slice(0, 10)} ${assignment.order.startTime}–${assignment.order.endTime}`;
          
          if (recipients.length) {
            await tx.notification.createMany({
              data: recipients.map((r) => ({
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
                NOT: { id },
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
        }
      });
    } catch (err) {
      success = false;
      errorCount++;
    }

    if (success) {
      processedIds.push(id);
      
      const shiftData = {
        date: assignment.order.shiftDate,
        startTime: assignment.order.startTime,
        endTime: assignment.order.endTime,
        qualification: assignment.order.requiredQualification,
        notes: assignment.order.notes || undefined,
        facilityName: assignment.order.client.facilityName,
        workerName: assignment.worker.fullName,
      };

      if (accept) {
        acceptedShifts.push(shiftData);
        
        // Group by client
        const clientId = assignment.order.client.userId;
        if (clientId) {
          if (!clientNotifications.has(clientId)) {
            clientNotifications.set(clientId, { userId: clientId, shifts: [] });
          }
          clientNotifications.get(clientId)!.shifts.push(shiftData);
        }

        // Notify withdrawn workers directly here, since it's fire-and-forget
        if (withdrawnUserIds.length > 0) {
          await pushToUsers(withdrawnUserIds, {
            title: "Einsatz bereits besetzt",
            body: `${formatDateDE(assignment.order.shiftDate)} ${assignment.order.startTime}–${assignment.order.endTime}`,
            url: workerShiftLink(),
            skipEmail: true,
          }).catch(() => {});
        }
      } else {
        declinedShifts.push(shiftData);
      }

      await audit({
        userId: user.id,
        action: accept ? "assignment.confirm" : "assignment.decline",
        entity: "Assignment",
        entityId: id,
        metadata: { actorRole: user.role, bulk: true },
      });
    }
  }

  // --- Send Bulk Grouped Emails ---
  
  // 1. Emails for ACCEPTED shifts
  if (acceptedShifts.length > 0) {
    const workerName = acceptedShifts[0].workerName;
    const workerUserId = user.id;

    const acceptedTableHtml = buildShiftHtmlTable(acceptedShifts);

    const adminHtml = `
      <p>Der Mitarbeiter <strong>${workerName}</strong> hat die folgenden Einsätze bestätigt:</p>
      ${acceptedTableHtml}
    `;

    const workerHtml = `
      <p>Hallo <strong>${workerName}</strong>,</p>
      <p>vielen Dank für die Bestätigung. Sie sind für folgende Einsätze fest eingeplant:</p>
      ${acceptedTableHtml}
      <p>Wir verlassen uns auf Sie. Bitte seien Sie pünktlich vor Ort.</p>
    `;

    // Wait for all promises in parallel
    const pushPromises: Promise<any>[] = [];

    // Push to admins
    pushPromises.push(
      pushToUsers(
        admins.map((a) => a.id),
        { title: "Einsätze bestätigt", body: `${workerName} hat ${acceptedShifts.length} Einsätze bestätigt.`, url: "/admin/orders", htmlBody: adminHtml },
      )
    );

    // Push to worker
    pushPromises.push(
      pushToUsers(
        [workerUserId],
        { title: "Einsätze bestätigt", body: `Sie haben ${acceptedShifts.length} Einsätze bestätigt.`, url: workerShiftLink(), htmlBody: workerHtml },
      )
    );

    // Push to clients (grouped)
    for (const clientGroup of clientNotifications.values()) {
      const clientHtml = `
        <p>Sehr geehrte Damen und Herren,</p>
        <p>wir freuen uns, Ihnen mitteilen zu können, dass die folgenden Einsätze von unserem Mitarbeiter <strong>${workerName}</strong> bestätigt wurden:</p>
        ${buildShiftHtmlTable(clientGroup.shifts)}
        <p>Unser Mitarbeiter wird pünktlich zum Dienstbeginn bei Ihnen vor Ort sein.</p>
      `;
      pushPromises.push(
        pushToUsers([clientGroup.userId], {
          title: "Einsätze bestätigt",
          body: `${workerName} hat ${clientGroup.shifts.length} Einsätze bestätigt.`,
          url: "/client/orders",
          htmlBody: clientHtml,
        })
      );
    }

    await Promise.all(pushPromises);
  }

  // 2. Emails for DECLINED shifts
  if (declinedShifts.length > 0) {
    const workerName = declinedShifts[0].workerName;
    
    const declineHtml = `
      <p>Der Mitarbeiter <strong>${workerName}</strong> hat die folgenden Einsätze abgelehnt:</p>
      ${buildShiftHtmlTable(declinedShifts)}
    `;

    await pushToUsers(
      admins.map((a) => a.id),
      { 
        title: "Einsätze abgelehnt", 
        body: `${workerName} hat ${declinedShifts.length} Einsätze abgelehnt.`, 
        url: "/admin/orders", 
        htmlBody: declineHtml 
      },
    );
  }

  revalidatePath("/worker");
  revalidatePath("/admin/orders");
  
  return { 
    ok: errorCount === 0, 
    processed: processedIds.length, 
    errors: errorCount,
    error: errorCount > 0 ? "someFailed" : undefined 
  };
}

// Worker accepts or declines an assignment they own. Admins may respond on
// the worker's behalf (e.g. acceptance given by phone) — the audit log keeps
// the acting user, so on-behalf responses stay traceable.
export async function respondAssignment(
  assignmentId: string,
  accept: boolean,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "super_admin";
  if (!user || (!isStaff && user.role !== "worker")) {
    return { ok: false, error: "forbidden" };
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      worker: { select: { userId: true, fullName: true, bio: true, qualification: true, skills: true, yearsExperience: true } },
      order: {
        select: {
          id: true,
          requestGroupId: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          requiredQualification: true,
          notes: true,
          client: { select: { userId: true, facilityName: true } },
        },
      },
    },
  });
  if (!assignment || (!isStaff && assignment.worker.userId !== user.id)) {
    return { ok: false, error: "forbidden" };
  }

  // Workers whose pending offer is withdrawn because the shift filled up — the
  // shift disappears from their portal; we let them know afterwards.
  let withdrawnUserIds: string[] = [];

  try {
    // SERIALIZABLE: the "confirmed ≤ quantity" invariant is checked-then-written,
    // so two workers racing for the last slot must not both pass the count. The
    // DB serialises them and we retry the loser (→ it sees the shift is full).
    // Accepting is allowed from a `declined` state too, so a worker (or the
    // office on their behalf) can reverse a shift they turned down by mistake.
    await runSerializable(async (tx) => {
      if (accept) {
        const orderData = await tx.order.findUnique({
          where: { id: assignment.order.id },
          select: {
            quantity: true,
            _count: {
              select: {
                assignments: {
                  where: { status: "confirmed", NOT: { id: assignmentId } },
                },
              },
            },
          },
        });
        if (!orderData || orderData._count.assignments >= orderData.quantity) {
          throw new Error("shiftFull");
        }
      }

      await tx.assignment.update({
        where: { id: assignmentId },
        data: {
          status: accept ? "confirmed" : "declined",
          confirmedAt: accept ? new Date() : null,
          // Re-accepting clears any stale withdrawal request on the row.
          ...(accept
            ? { cancelRequested: false, cancelNote: null, cancelRequestedAt: null }
            : {}),
        },
      });

      if (accept) {
        await tx.order.update({
          where: { id: assignment.order.id },
          data: { status: "accepted" },
        });
        const recipients = await tx.user.findMany({
          where: {
            OR: [
              { id: assignment.order.client.userId },
              { role: { in: ["admin", "super_admin"] }, active: true },
            ],
          },
          select: { id: true, role: true },
        });
        const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
        const label = `${assignment.order.shiftDate
          .toISOString()
          .slice(0, 10)} ${assignment.order.startTime}–${assignment.order.endTime}`;
        if (recipients.length) {
          await tx.notification.createMany({
            data: recipients.map((r) => ({
              userId: r.id,
              type: "worker_confirmed" as const,
              channel: "in_app" as const,
              content: `${assignment.worker.fullName}: ${label}`,
              link: orderLink(r.role, reqGroup),
            })),
          });
        }

        // Once the headcount is met, the shift is off the market: withdraw every
        // remaining pending offer so it disappears from the other workers'
        // portals (a shift can't be double-booked past its quantity).
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
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message === "shiftFull") {
      return { ok: false, error: "shiftFull" };
    }
    return { ok: false, error: "saveError" };
  }

  await audit({
    userId: user.id,
    action: accept ? "assignment.confirm" : "assignment.decline",
    entity: "Assignment",
    entityId: assignmentId,
    metadata: { actorRole: user.role },
  });

  // Mobile push to the office + client + worker when the worker accepts.
  if (accept) {
    const body = `${assignment.worker.fullName}: ${formatDateDE(assignment.order.shiftDate)} ${assignment.order.startTime}–${assignment.order.endTime}`;
    const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
    const admins = await prisma.user.findMany({
      where: { role: { in: ["admin", "super_admin"] }, active: true },
      select: { id: true },
    });
    const clientUserId = assignment.order.client.userId;

    const shiftHtml = `
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px; font-family: sans-serif; font-size: 14px;">
        <thead>
          <tr style="background-color: #f3f4f6; text-align: left;">
            <th style="padding: 10px; border: 1px solid #e5e7eb;">Datum</th>
            <th style="padding: 10px; border: 1px solid #e5e7eb;">Zeit</th>
            <th style="padding: 10px; border: 1px solid #e5e7eb;">Qualifikation</th>
            <th style="padding: 10px; border: 1px solid #e5e7eb;">Bereich/Notizen</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${formatDateDE(assignment.order.shiftDate)}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${assignment.order.startTime} - ${assignment.order.endTime}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${assignment.order.requiredQualification}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${assignment.order.notes || '-'}</td>
          </tr>
        </tbody>
      </table>
    `;

    const adminHtml = `
      <p>Der Mitarbeiter <strong>${assignment.worker.fullName}</strong> hat den folgenden Einsatz bestätigt:</p>
      ${shiftHtml}
    `;

    const workerHtml = `
      <p>Hallo <strong>${assignment.worker.fullName}</strong>,</p>
      <p>vielen Dank für die Bestätigung. Sie sind für folgenden Einsatz fest eingeplant:</p>
      ${shiftHtml}
      <p>Wir verlassen uns auf Sie. Bitte seien Sie pünktlich vor Ort.</p>
    `;

    const workerProfile = `
      <div style="margin-top: 20px; padding: 15px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;">
        <h3 style="margin-top: 0; margin-bottom: 15px; color: #111827;">Mitarbeiterprofil</h3>
        <p style="margin: 5px 0;"><strong>Name:</strong> ${assignment.worker.fullName}</p>
        <p style="margin: 5px 0;"><strong>Qualifikation:</strong> ${assignment.worker.qualification}</p>
        ${assignment.worker.yearsExperience ? `<p style="margin: 5px 0;"><strong>Erfahrung:</strong> ${assignment.worker.yearsExperience} Jahre</p>` : ''}
        ${assignment.worker.skills.length > 0 ? `<p style="margin: 5px 0;"><strong>Fähigkeiten:</strong> ${assignment.worker.skills.join(', ')}</p>` : ''}
        ${assignment.worker.bio ? `<p style="margin: 5px 0;"><strong>Über mich:</strong> ${assignment.worker.bio}</p>` : ''}
      </div>
    `;

    const clientHtml = `
      <p>Sehr geehrte Damen und Herren,</p>
      <p>wir freuen uns, Ihnen mitteilen zu können, dass der folgende Einsatz von unserem Mitarbeiter <strong>${assignment.worker.fullName}</strong> bestätigt wurde:</p>
      ${shiftHtml}
      ${workerProfile}
      <p>Unser Mitarbeiter wird pünktlich zum Dienstbeginn bei Ihnen vor Ort sein.</p>
    `;

    await Promise.all([
      clientUserId
        ? pushToUsers([clientUserId], {
            title: "Einsatz bestätigt",
            body,
            url: orderLink("client", reqGroup),
            htmlBody: clientHtml,
          })
        : Promise.resolve(),
      pushToUsers(
        admins.map((a) => a.id),
        { title: "Einsatz bestätigt", body, url: orderLink("admin", reqGroup), htmlBody: adminHtml },
      ),
      pushToUsers(
        [assignment.worker.userId],
        { title: "Einsatz bestätigt", body, url: workerShiftLink(), htmlBody: workerHtml },
      ),
      // Tell the workers who lost the offer that it's been filled.
      withdrawnUserIds.length
        ? pushToUsers(withdrawnUserIds, {
            title: "Einsatz bereits besetzt",
            body: `${formatDateDE(assignment.order.shiftDate)} ${assignment.order.startTime}–${assignment.order.endTime}`,
            url: workerShiftLink(),
            skipEmail: true,
          })
        : Promise.resolve(),
    ]);
  } else {
    // When the worker declines a shift.
    const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
    const admins = await prisma.user.findMany({
      where: { role: { in: ["admin", "super_admin"] }, active: true },
      select: { id: true },
    });
    
    const declineHtml = `
      <p>Der Mitarbeiter <strong>${assignment.worker.fullName}</strong> hat den folgenden Einsatz abgelehnt:</p>
      ${buildShiftHtmlTable([{
        date: assignment.order.shiftDate,
        startTime: assignment.order.startTime,
        endTime: assignment.order.endTime,
        qualification: assignment.order.requiredQualification,
        notes: assignment.order.notes || undefined,
        facilityName: assignment.order.client.facilityName,
        workerName: assignment.worker.fullName,
      }])}
    `;

    await pushToUsers(
      admins.map((a) => a.id),
      { 
        title: "Einsatz abgelehnt", 
        body: `${assignment.worker.fullName} hat den Einsatz abgelehnt.`, 
        url: orderLink("admin", reqGroup), 
        htmlBody: declineHtml 
      },
    );
  }

  revalidatePath("/worker");
  revalidatePath(`/admin/orders/${assignment.order.id}`);
  revalidatePath(`/admin/workers/${assignment.workerId}/schedule`);
  return { ok: true };
}

// The worker asks the office to be taken off a shift they already accepted,
// with a note explaining why. This does NOT release the shift — it flags a
// pending request the admin approves (→ released to the grey pool) or rejects.
// The note reaches the office as an inbox message + notification + push, and the
// shift shows "awaiting reply" in the schedule and the admin hours page.
export async function requestShiftCancellation(
  assignmentId: string,
  note: string,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "worker") return { ok: false, error: "forbidden" };

  const parsedNote = z.string().trim().max(1000).safeParse(note);
  if (!parsedNote.success) return { ok: false, error: "saveError" };

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      worker: { select: { userId: true, fullName: true } },
      serviceConfirmation: { select: { id: true } },
      order: {
        select: {
          id: true,
          requestGroupId: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          client: { select: { facilityName: true } },
        },
      },
    },
  });
  if (!assignment || assignment.worker.userId !== user.id) {
    return { ok: false, error: "forbidden" };
  }
  // Signed shifts are a legal record — can't be cancelled here.
  if (assignment.serviceConfirmation) return { ok: false, error: "confirmed" };
  if (assignment.status === "declined") return { ok: false, error: "saveError" };

  await prisma.assignment.update({
    where: { id: assignmentId },
    data: {
      cancelRequested: true,
      cancelNote: parsedNote.data || null,
      cancelRequestedAt: new Date(),
    },
  });

  const label = `${formatDateDE(assignment.order.shiftDate)} ${assignment.order.startTime}–${assignment.order.endTime}`;
  const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
  const summary = `${assignment.worker.fullName}: Abmeldung angefragt – ${label}`;

  const admins = await prisma.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, active: true },
    select: { id: true },
  });

  // In-app notification to every admin (deep-links to the order request).
  if (admins.length) {
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        type: "order_status_changed" as const,
        channel: "in_app" as const,
        content: summary,
        link: orderLink("admin", reqGroup),
      })),
    });
  }

  // The note lands in the assignment's inbox thread so the office can reply.
  const { getOrCreateAssignmentConversation } = await import("@/lib/inbox");
  const conversation = await getOrCreateAssignmentConversation(assignmentId);
  const body = parsedNote.data
    ? `Abmeldung angefragt (${label}): ${parsedNote.data}`
    : `Abmeldung angefragt (${label}).`;
  const now = new Date();
  if (conversation) {
    await prisma.$transaction([
      prisma.message.create({
        data: { conversationId: conversation.id, senderId: user.id, body },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now },
      }),
      prisma.conversationParticipant.update({
        where: {
          conversationId_userId: { conversationId: conversation.id, userId: user.id },
        },
        data: { lastReadAt: now },
      }),
    ]);
  }

  const shiftsHtml = buildShiftHtmlTable([{
    date: assignment.order.shiftDate,
    startTime: assignment.order.startTime,
    endTime: assignment.order.endTime,
    qualification: assignment.worker.qualification, // The worker's qualification or the order's required qualification.
    facilityName: assignment.order.client.facilityName,
    workerName: assignment.worker.fullName,
  }]);

  await pushToUsers(
    admins.map((a) => a.id),
    {
      title: "Abmeldung angefragt",
      body: summary,
      url: conversation ? inboxLink("admin", conversation.id) : orderLink("admin", reqGroup),
      htmlBody: \`
        <p>Der Mitarbeiter <strong>\${assignment.worker.fullName}</strong> bittet um Abmeldung von folgendem Einsatz:</p>
        <p><strong>Notiz:</strong> \${parsedNote.data || '-'}</p>
        \${shiftsHtml}
      \`
    },
  );

  await audit({
    userId: user.id,
    action: "assignment.cancelRequest",
    entity: "Assignment",
    entityId: assignmentId,
    metadata: { hasNote: Boolean(parsedNote.data) },
  });

  revalidatePath("/worker");
  revalidatePath("/admin/schedule");
  revalidatePath(`/admin/workers/${assignment.workerId}/schedule`);
  revalidatePath(`/admin/orders/${reqGroup}`);
  return { ok: true };
}
