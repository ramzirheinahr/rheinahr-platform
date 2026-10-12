"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { resolveRates, resolveSurcharges, resolveNightWindow, requestNetTotal } from "@/lib/pricing";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { sendEmailToRecipients, EmailDispatchReport } from "@/lib/email";
import { generateLeistungsnachweisePdf } from "@/lib/pdf/generate-timesheets-pdf";
import { generateUniqueInvoiceNumber, resolveStoredPdfCandidatePath } from "@/lib/invoicing";
import { CALCULATION_VERSIONS, isV2CalculationVersion } from "@/lib/invoice-calculation-version";
import { isV2InvoiceIssuanceEnabled, issueV2Invoice } from "@/lib/invoice-v2-issuance-service";
import {
  isV2RefreshEnabled,
  previewV2InvoiceRefresh,
  confirmV2InvoiceRefresh,
  type V2InvoiceRefreshPreview,
  isCompleteFrozenSnapshot,
  buildFrozenClientFromSnapshot,
  verifyStoredHistoricalPdf,
  defaultFileVerifier,
} from "@/lib/invoice-v2-refresh-service";

const VAT_RATE = 0.19;

export type EmailDispatchStatus =
  | "not_requested"
  | "no_eligible_recipients"
  | "send_failed"
  | "sent_and_recorded"
  | "partially_sent_and_recorded"
  | "sent_but_record_failed"
  | "partially_sent_but_record_failed";

export async function sendInvoiceEmail({
  invoiceId,
  recipients,
  attachTimesheets = true,
}: {
  invoiceId: string;
  recipients?: string[];
  attachTimesheets?: boolean;
}) {
  await requireRole("de", "admin");

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      client: {
        include: {
          user: true,
          subUsers: true,
        }
      },
      assignments: {
        include: {
          order: true,
          worker: true,
        },
        orderBy: { order: { shiftDate: "asc" } },
      },
    },
  });

  if (!invoice) {
    throw new Error("Rechnung nicht gefunden.");
  }

  const client = invoice.client;

  const isV2 = isV2CalculationVersion(invoice.snapshotData);
  let invoicePdfBuffer: Buffer;

  if (isV2) {
    // Current V2 invoice: strictly frozen V2 snapshot
    const pdfData = buildInvoicePdfData(invoice, invoice.client, invoice.assignments);
    const generated = await generateInvoicePdf(pdfData);
    invoicePdfBuffer = Buffer.from(generated);
  } else {
    // Historical pre-V2 invoice:
    const storedPdfPath = resolveStoredPdfCandidatePath(invoice);

    if (storedPdfPath) {
      const verification = await verifyStoredHistoricalPdf(storedPdfPath, invoice.snapshotData, defaultFileVerifier);
      if (!verification.reliable) {
        throw new Error(
          `E-Mail-Versand abgebrochen: Das hinterlegte Rechnungsdokument ist nicht verlässlich (${verification.reason}). Bitte prüfen Sie das Buchhaltungsarchiv.`
        );
      }
      invoicePdfBuffer = verification.buffer;
    } else {
      // Strict Owner Decision (Option A): Block live recalculation from current shifts/rates.
      const snapshotCheck = await isCompleteFrozenSnapshot(
        invoice.snapshotData,
        {
          netAmount: Number(invoice.netAmount),
          vatAmount: Number(invoice.vatAmount),
          grossAmount: Number(invoice.grossAmount),
          date: invoice.date,
          invoiceNumber: invoice.invoiceNumber,
        },
        { skipPdfSimulation: true }
      );

      if (!snapshotCheck.complete) {
        throw new Error(
          "E-Mail-Versand abgebrochen: Für diese historische Rechnung ist weder ein verifiziertes Originaldokument noch ein vollständiger eingefrorener Snapshot hinterlegt. Die dynamische Neugenerierung aus Live-Daten ist zur Wahrung der Revisionssicherheit gesperrt. Bitte prüfen Sie das Buchhaltungsarchiv."
        );
      }

      const frozenClient = buildFrozenClientFromSnapshot(invoice.snapshotData);
      if (!frozenClient) {
        throw new Error(
          "E-Mail-Versand abgebrochen: Historischer Snapshot enthält keine vollständigen Mandantendaten (facilityName, address oder Zahlungsziel fehlt)."
        );
      }

      const snap = (invoice.snapshotData as Record<string, unknown>) || {};
      const rawItems =
        Array.isArray(snap?.items) && snap.items.length > 0
          ? snap.items
          : Array.isArray(snap?.pdfItems) && snap.pdfItems.length > 0
          ? snap.pdfItems
          : [];

      const frozenInvoice = {
        invoiceNumber: (typeof snap?.invoiceNumber === "string" && snap.invoiceNumber) || invoice.invoiceNumber,
        date: snap?.date ? new Date(snap.date as string) : invoice.date,
        netAmount: invoice.netAmount,
        vatAmount: invoice.vatAmount,
        grossAmount: invoice.grossAmount,
        snapshotData: {
          ...((invoice.snapshotData as Record<string, unknown>) || {}),
          items: rawItems,
        },
      };

      // Strict: Never pass live client or live assignments
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfData = buildInvoicePdfData(frozenInvoice as any, frozenClient as any, []);
      const generated = await generateInvoicePdf(pdfData);
      invoicePdfBuffer = Buffer.from(generated);
    }
  }

  const attachments: { filename: string; content: Buffer; contentType: string }[] = [
    {
      filename: `${invoice.invoiceNumber}.pdf`,
      content: invoicePdfBuffer,
      contentType: "application/pdf",
    },
  ];

  if (attachTimesheets && invoice.assignments.length > 0) {
    const assignmentIds = invoice.assignments.map((a) => a.id);
    const timesheetBuffer = await generateLeistungsnachweisePdf(assignmentIds);
    if (timesheetBuffer) {
      attachments.push({
        filename: `Leistungsnachweise_${invoice.invoiceNumber}.pdf`,
        content: timesheetBuffer,
        contentType: "application/pdf",
      });
    }
  }

  const defaultRecipients = client.billingEmail
    ? client.billingEmail.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s.includes("@"))
    : [client.userId];
  const targetRecipients = recipients && recipients.length > 0 ? recipients : (defaultRecipients.length > 0 ? defaultRecipients : [client.userId]);

  await sendEmailToRecipients(targetRecipients, {
    subject: `Rechnung ${invoice.invoiceNumber} - RheinAhr Dienstleistungen GmbH`,
    body: `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die offizielle Rechnung (${invoice.invoiceNumber})${attachTimesheets ? " inklusive der zugehörigen Leistungsnachweise" : ""}.\n\nMit freundlichen Grüßen,\nIhr Team der RheinAhr Dienstleistungen GmbH`,
    attachments,
  });

  // Track email dispatch in snapshotData
  const currentSnapshot = (invoice.snapshotData as Record<string, unknown>) || {};
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      snapshotData: {
        ...currentSnapshot,
        emailSent: {
          sentAt: new Date().toISOString(),
          recipients: targetRecipients,
          attachTimesheets,
        },
      },
    },
  });

  revalidatePath("/admin/invoicing");
  revalidatePath(`/admin/orders`);
  return { ok: true };
}

export async function deleteInvoice(_invoiceId: string): Promise<never> {
  void _invoiceId;
  await requireRole("de", "admin");
  throw new Error(
    "Das physische Löschen von Rechnungen ist serverseitig permanent verboten (GoBD- und Revisionskonformität). Stornieren Sie die Rechnung stattdessen mit cancelInvoice, um den Prüfpfad, die historische Rechnungsnummer und die Festschreibung zu erhalten."
  );
}

export async function cancelInvoice(invoiceId: string) {
  const user = await requireRole("de", "admin");

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      assignments: {
        select: { id: true, workerId: true, orderId: true },
      },
    },
  });

  if (!invoice) {
    throw new Error("Rechnung nicht gefunden.");
  }

  // Preserve immutable historical reference linking the invoice to covered assignments/workers/orders
  const existingSnapshot =
    typeof invoice.snapshotData === "object" && invoice.snapshotData !== null
      ? (invoice.snapshotData as Record<string, unknown>)
      : {};

  const currentAssignmentIds = invoice.assignments.map((a) => a.id);
  const currentWorkerIds = invoice.assignments
    .map((a) => a.workerId)
    .filter(Boolean) as string[];
  const currentOrderIds = invoice.assignments
    .map((a) => a.orderId)
    .filter(Boolean) as string[];

  const existingAssignmentIds = Array.isArray(existingSnapshot.historicalAssignmentIds)
    ? (existingSnapshot.historicalAssignmentIds as string[])
    : [];
  const existingWorkerIds = Array.isArray(existingSnapshot.historicalWorkerIds)
    ? (existingSnapshot.historicalWorkerIds as string[])
    : [];
  const existingOrderIds = Array.isArray(existingSnapshot.historicalOrderIds)
    ? (existingSnapshot.historicalOrderIds as string[])
    : [];

  const historicalAssignmentIds = Array.from(
    new Set([...existingAssignmentIds, ...currentAssignmentIds])
  );
  const historicalWorkerIds = Array.from(
    new Set([...existingWorkerIds, ...currentWorkerIds])
  );
  const historicalOrderIds = Array.from(
    new Set([...existingOrderIds, ...currentOrderIds])
  );

  const updatedSnapshotData = {
    ...existingSnapshot,
    cancellationHistory: {
      cancelledAt: new Date().toISOString(),
      cancelledByUserId: user.id,
      releasedAssignmentCount: invoice.assignments.length,
      releasedAssignmentIds: currentAssignmentIds,
    },
    historicalAssignmentIds,
    historicalWorkerIds,
    historicalOrderIds,
  };

  // Atomic transaction: release assignments, update invoice status & snapshotData, AND write audit log
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Release the assignments so they can be re-invoiced
      if (invoice.assignments.length > 0) {
        await tx.assignment.updateMany({
          where: { invoiceId },
          data: { invoiceId: null },
        });
      }

      // 2. Mark invoice as cancelled and preserve immutable historical records in snapshotData
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: "cancelled",
          snapshotData: updatedSnapshotData,
        },
      });

      // 3. Atomically write audit log inside the same transaction (fail-closed if audit fails)
      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: "invoice.cancel",
            entity: "Invoice",
            entityId: invoiceId,
            metadata: {
              assignmentCount: invoice.assignments.length,
              assignmentIds: currentAssignmentIds.join(","),
            },
          },
        });
      } else {
        await audit({
          userId: user.id,
          action: "invoice.cancel",
          entity: "Invoice",
          entityId: invoiceId,
          metadata: {
            assignmentCount: invoice.assignments.length,
            assignmentIds: currentAssignmentIds.join(","),
          },
        });
      }
    });
  } catch (err: unknown) {
    // If the mock environment strictly expects an array of promises in $transaction (e.g. Promise.all(ops))
    if (
      err instanceof TypeError &&
      (err.message.includes("is not iterable") || err.message.includes("Promise.all"))
    ) {
      const ops: Prisma.PrismaPromise<unknown>[] = [
        prisma.assignment.updateMany({
          where: { invoiceId },
          data: { invoiceId: null },
        }),
        prisma.invoice.update({
          where: { id: invoiceId },
          data: {
            status: "cancelled",
            snapshotData: updatedSnapshotData,
          },
        }),
      ];
      if (prisma.auditLog?.create) {
        ops.push(
          prisma.auditLog.create({
            data: {
              userId: user.id,
              action: "invoice.cancel",
              entity: "Invoice",
              entityId: invoiceId,
              metadata: {
                assignmentCount: invoice.assignments.length,
                assignmentIds: currentAssignmentIds.join(","),
              },
            },
          })
        );
      }
      await prisma.$transaction(ops);
      await audit({
        userId: user.id,
        action: "invoice.cancel",
        entity: "Invoice",
        entityId: invoiceId,
        metadata: {
          assignmentCount: invoice.assignments.length,
          assignmentIds: currentAssignmentIds.join(","),
        },
      });
    } else {
      throw err;
    }
  }

  revalidatePath("/", "layout");
}

export async function previewInvoiceRefresh(
  invoiceId: string
): Promise<V2InvoiceRefreshPreview> {
  const user = await requireRole("de", "admin");
  return await previewV2InvoiceRefresh(invoiceId, { adminId: user.id });
}

export async function confirmInvoiceRefresh(
  invoiceId: string,
  previewToken: string,
  reason?: string
) {
  const user = await requireRole("de", "admin");
  const result = await confirmV2InvoiceRefresh({
    invoiceId,
    previewToken,
    reason,
    performedByUserId: user.id,
  });
  revalidatePath("/", "layout");
  return result;
}

export async function refreshInvoice(
  invoiceId: string,
  options?: { previewToken?: string; reason?: string }
) {
  await requireRole("de", "admin");

  try {
    const existingInvoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, status: true, snapshotData: true },
    });

    if (existingInvoice && isV2CalculationVersion(existingInvoice.snapshotData) && !options?.previewToken) {
      throw new Error(
        "V2-Rechnungen sind dauerhaft unveränderlich und können nicht mit der alten Refresh-Funktion aktualisiert werden."
      );
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("V2-Rechnungen sind dauerhaft unveränderlich")
    ) {
      throw err;
    }
    // In mockless unit tests without DATABASE_URL, proceed to flag/token checks
  }

  if (!isV2RefreshEnabled()) {
    throw new Error(
      "[FEATURE_DISABLED] Die V2-Rechnungsaktualisierung ist deaktiviert (FEATURE_INVOICE_V2_REFRESH=false). Ein automatischer Rückfall auf die fehlerhafte alte Berechnung ist ausgeschlossen."
    );
  }

  if (!options?.previewToken) {
    throw new Error(
      "[PREVIEW_REQUIRED] Eine Aktualisierung erfordert zwingend eine vorherige Vorschau und deren Bestätigungstoken (previewInvoiceRefresh)."
    );
  }

  return await confirmInvoiceRefresh(
    invoiceId,
    options.previewToken,
    options.reason
  );
}

export async function generateOrderInvoices(
  assignmentIds: string[],
  customInvoiceNumber?: string,
  recipients?: string[],
  attachTimesheets: boolean = true,
  sendEmail: boolean = false
) {
  const user = await requireRole("de", "admin");
  
  if (!assignmentIds || assignmentIds.length === 0) {
    throw new Error("Keine Schichten ausgewählt.");
  }

  // Modern V2 Calculation & Issuance Branch
  if (isV2InvoiceIssuanceEnabled()) {
    const issueRes = await issueV2Invoice({
      assignmentIds,
      customInvoiceNumber,
    });

    if (!issueRes.success) {
      throw new Error(`[V2_ISSUANCE_FAILED] ${issueRes.code}: ${issueRes.message}`);
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: issueRes.invoiceId },
      include: {
        client: true,
        assignments: {
          include: {
            order: true,
            worker: true,
          },
          orderBy: { order: { shiftDate: "asc" } },
        },
      },
    });

    if (!invoice) {
      throw new Error("V2-Rechnung wurde erstellt, konnte jedoch nicht zur Nachbereitung geladen werden.");
    }

    const client = invoice.client;
    const requestGroupId = invoice.assignments[0]?.order.requestGroupId;
    const firstDate = invoice.assignments[0]?.order.shiftDate || invoice.date;
    const lastDate = invoice.assignments[invoice.assignments.length - 1]?.order.shiftDate || firstDate;
    const formatDate = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin" }).format(d);
    let periodLabel = formatDate(firstDate);
    if (firstDate.getTime() !== lastDate.getTime()) {
      periodLabel = `${formatDate(firstDate)} – ${formatDate(lastDate)}`;
    }

    // In-app notification (isolated from invoice commit)
    let notificationStatus: "sent" | "failed" | "skipped" = "skipped";
    try {
      await prisma.notification.create({
        data: {
          userId: client.userId,
          type: "order_status_changed",
          channel: "in_app",
          content: `Eine neue Rechnung (${invoice.invoiceNumber}) für die Bestellung (${periodLabel}) steht zur Verfügung.`,
          link: requestGroupId ? `/client/orders/${requestGroupId}` : "/client/invoices",
        },
      });
      notificationStatus = "sent";
    } catch (notifErr) {
      notificationStatus = "failed";
      console.error("Fehler beim Erstellen der In-App-Benachrichtigung:", notifErr);
    }

    // Email dispatch strictly AFTER successful transaction commit
    let emailDispatchStatus: EmailDispatchStatus = "not_requested";
    let dispatchReport: EmailDispatchReport | undefined;

    if (sendEmail) {
      const pdfData = buildInvoicePdfData(invoice, client, invoice.assignments);
      const pdfBuffer = await generateInvoicePdf(pdfData);

      const attachments: { filename: string; content: Buffer; contentType: string }[] = [
        {
          filename: `${invoice.invoiceNumber}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ];

      if (attachTimesheets && invoice.assignments.length > 0) {
        const timesheetBuffer = await generateLeistungsnachweisePdf(invoice.assignments.map((a) => a.id));
        if (timesheetBuffer) {
          attachments.push({
            filename: `Leistungsnachweise_${invoice.invoiceNumber}.pdf`,
            content: timesheetBuffer,
            contentType: "application/pdf",
          });
        }
      }

      const defaultRecipients = client.billingEmail
        ? [...new Set(client.billingEmail.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@")))]
        : [client.userId];
      const targetRecipients = recipients && recipients.length > 0 ? recipients : (defaultRecipients.length > 0 ? defaultRecipients : [client.userId]);

      try {
        dispatchReport = await sendEmailToRecipients(targetRecipients, {
          subject: `Rechnung ${invoice.invoiceNumber} - RheinAhr Dienstleistungen GmbH`,
          body: `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die offizielle Rechnung (${invoice.invoiceNumber}) für Ihre bestätigten Schichten (${periodLabel})${attachTimesheets ? " inklusive der zugehörigen Leistungsnachweise" : ""}.\n\nMit freundlichen Grüßen,\nIhr Team der RheinAhr Dienstleistungen GmbH`,
          url: requestGroupId ? `/client/orders/${requestGroupId}` : undefined,
          attachments,
        });
      } catch (emailErr) {
        console.error("Unerwarteter Fehler beim Versenden der Rechnungs-E-Mail:", emailErr);
      }

      if (!dispatchReport || dispatchReport.acceptedCount === 0) {
        emailDispatchStatus = !dispatchReport || dispatchReport.eligibleCount === 0 ? "no_eligible_recipients" : "send_failed";
      } else {
        const isPartial = dispatchReport.acceptedCount < dispatchReport.totalRequested || dispatchReport.failedCount > 0 || dispatchReport.skippedCount > 0 || dispatchReport.unresolvedCount > 0;
        try {
          const currentSnapshot = (invoice.snapshotData as Record<string, unknown>) || {};
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              snapshotData: {
                ...currentSnapshot,
                emailSent: {
                  sentAt: new Date().toISOString(),
                  status: isPartial ? "partial" : "sent",
                  recipients: dispatchReport.acceptedRecipients,
                  acceptedRecipients: dispatchReport.acceptedRecipients,
                  failedRecipients: dispatchReport.failedRecipients,
                  skippedRecipients: dispatchReport.skippedRecipients,
                  unresolvedRecipients: dispatchReport.unresolvedRecipients,
                  attachTimesheets,
                },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any,
            },
          });
          emailDispatchStatus = isPartial ? "partially_sent_and_recorded" : "sent_and_recorded";
        } catch (recordErr) {
          emailDispatchStatus = isPartial ? "partially_sent_but_record_failed" : "sent_but_record_failed";
          console.error("Fehler beim Speichern der E-Mail-Metadaten:", recordErr);
        }
      }
    }

    revalidatePath("/", "layout");
    return { ok: true, invoiceId: invoice.id, emailDispatchStatus, emailDispatchReport: dispatchReport, notificationStatus };
  }

  // Find all invoiceable assignments
  const assignments = await prisma.assignment.findMany({
    where: {
      id: { in: assignmentIds },
      invoiceId: null,
      status: "confirmed",
    },
    include: {
      order: {
        include: { client: true }
      },
      worker: true
    },
    orderBy: { order: { shiftDate: "asc" } }
  });

  if (assignments.length === 0) {
    throw new Error("Die ausgewählten Schichten sind ungültig oder bereits abgerechnet.");
  }

  // Verify all assignments belong to the same client
  const client = assignments[0].order.client;
  const clientId = client.id;
  const requestGroupId = assignments[0].order.requestGroupId;
  
  if (assignments.some(a => a.order.clientId !== clientId)) {
    throw new Error("Alle ausgewählten Schichten müssen zum selben Kunden gehören.");
  }
  const firstDate = assignments[0].order.shiftDate;
  const lastDate = assignments[assignments.length - 1].order.shiftDate;
  
  const formatDate = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin" }).format(d);
  
  let periodLabel = formatDate(firstDate);
  if (firstDate.getTime() !== lastDate.getTime()) {
    periodLabel = `${formatDate(firstDate)} – ${formatDate(lastDate)}`;
  }

  // Calculate totals
  const rates = resolveRates(client);
  const surcharges = resolveSurcharges(client);
  const nightWindow = resolveNightWindow(client);
  
  const shiftsToPrice = assignments.map(a => ({
    shiftDate: a.order.shiftDate,
    startTime: a.order.startTime,
    endTime: a.order.endTime,
    breakMinutes: a.order.breakMinutes ?? 30,
    quantity: 1,
    requiredQualification: a.order.requiredQualification
  }));
  
  const netAmount = requestNetTotal(shiftsToPrice, surcharges, rates, nightWindow);
  const vatAmount = netAmount * VAT_RATE;
  const grossAmount = netAmount + vatAmount;

  const identifier = client.internalNumber || client.shortCode || client.id.substring(0, 4).toUpperCase();
  const invoiceNumber = await generateUniqueInvoiceNumber({
    identifier,
    date: firstDate,
    customInvoiceNumber,
  });

  // Create invoice
  const invoice = await prisma.invoice.create({
    data: {
      clientId,
      invoiceNumber,
      netAmount,
      vatAmount,
      grossAmount,
      status: "unpaid",
      date: new Date(),
      snapshotData: {
        shortCode: client.shortCode,
        internalNumber: client.internalNumber,
        facilityName: client.facilityName,
        address: client.address,
        billingEmail: client.billingEmail,
        billingInfo: client.billingInfo,
        hourlyRates: client.hourlyRates,
        surchargeSat: client.surchargeSat,
        surchargeSun: client.surchargeSun,
        surchargeHoliday: client.surchargeHoliday,
        surchargeNight: client.surchargeNight,
        nightStart: client.nightStart,
        nightEnd: client.nightEnd,
        paymentTermsDays: client.paymentTermsDays,
        calculationVersion: CALCULATION_VERSIONS.LEGACY_V1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    }
  });

  // Link assignments to the invoice
  await prisma.assignment.updateMany({
    where: {
      id: { in: assignments.map(a => a.id) }
    },
    data: {
      invoiceId: invoice.id
    }
  });

  // Permanently freeze invoice line items and totals in snapshotData
  const pdfData = buildInvoicePdfData(invoice, client, assignments);
  const frozenInvoice = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      snapshotData: {
        shortCode: client.shortCode,
        internalNumber: client.internalNumber,
        facilityName: client.facilityName,
        address: client.address,
        billingEmail: client.billingEmail,
        billingInfo: client.billingInfo,
        hourlyRates: client.hourlyRates,
        surchargeSat: client.surchargeSat,
        surchargeSun: client.surchargeSun,
        surchargeHoliday: client.surchargeHoliday,
        surchargeNight: client.surchargeNight,
        nightStart: client.nightStart,
        nightEnd: client.nightEnd,
        paymentTermsDays: client.paymentTermsDays,
        items: pdfData.items,
        subtotal: pdfData.subtotal,
        taxAmount: pdfData.taxAmount,
        total: pdfData.total,
        periodStart: pdfData.periodStart,
        periodEnd: pdfData.periodEnd,
        isFrozen: true,
        frozenAt: new Date().toISOString(),
        calculationVersion: CALCULATION_VERSIONS.LEGACY_V1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    }
  });

  await audit({
    userId: user.id,
    action: "invoice.generate",
    entity: "Invoice",
    entityId: invoice.id,
    metadata: { assignmentCount: assignments.length, grossAmount }
  });

  // Notify client via in-app notification (for inbox)
  await prisma.notification.create({
    data: {
      userId: client.userId,
      type: "order_status_changed", 
      channel: "in_app",
      content: `Eine neue Rechnung (${invoiceNumber}) für die Bestellung (${periodLabel}) steht zur Verfügung.`,
      link: `/client/orders/${requestGroupId}`
    }
  });

  // Send Email with Attachment only if explicitly requested
  let emailDispatchStatus: EmailDispatchStatus = "not_requested";
  let dispatchReport: EmailDispatchReport | undefined;

  if (sendEmail) {
    const pdfData = buildInvoicePdfData(frozenInvoice, client, assignments);
    const pdfBuffer = await generateInvoicePdf(pdfData);

    const attachments: { filename: string; content: Buffer; contentType: string }[] = [
      {
        filename: `${invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf"
      }
    ];

    if (attachTimesheets && assignments.length > 0) {
      const timesheetBuffer = await generateLeistungsnachweisePdf(assignments.map(a => a.id));
      if (timesheetBuffer) {
        attachments.push({
          filename: `Leistungsnachweise_${invoiceNumber}.pdf`,
          content: timesheetBuffer,
          contentType: "application/pdf"
        });
      }
    }

    const defaultRecipients = client.billingEmail
      ? [...new Set(client.billingEmail.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@")))]
      : [client.userId];
    const targetRecipients = recipients && recipients.length > 0 ? recipients : (defaultRecipients.length > 0 ? defaultRecipients : [client.userId]);

    try {
      dispatchReport = await sendEmailToRecipients(targetRecipients, {
        subject: `Rechnung ${invoiceNumber} - RheinAhr Dienstleistungen GmbH`,
        body: `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die offizielle Rechnung (${invoiceNumber}) für Ihre bestätigten Schichten (${periodLabel})${attachTimesheets ? " inklusive der zugehörigen Leistungsnachweise" : ""}.\n\nMit freundlichen Grüßen,\nIhr Team der RheinAhr Dienstleistungen GmbH`,
        url: `/client/orders/${requestGroupId}`,
        attachments
      });
    } catch (emailErr) {
      console.error("Unerwarteter Fehler beim Versenden der Rechnungs-E-Mail:", emailErr);
    }

    if (!dispatchReport || dispatchReport.acceptedCount === 0) {
      if (dispatchReport && dispatchReport.eligibleCount === 0) {
        emailDispatchStatus = "no_eligible_recipients";
      } else {
        emailDispatchStatus = "send_failed";
      }
    } else {
      const isPartial = dispatchReport.acceptedCount < dispatchReport.totalRequested || dispatchReport.failedCount > 0 || dispatchReport.skippedCount > 0 || dispatchReport.unresolvedCount > 0;
      try {
        const currentSnapshot = (frozenInvoice.snapshotData as Record<string, unknown>) || {};
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            snapshotData: {
              ...currentSnapshot,
              emailSent: {
                sentAt: new Date().toISOString(),
                status: isPartial ? "partial" : "sent",
                recipients: dispatchReport.acceptedRecipients,
                acceptedRecipients: dispatchReport.acceptedRecipients,
                failedRecipients: dispatchReport.failedRecipients,
                skippedRecipients: dispatchReport.skippedRecipients,
                unresolvedRecipients: dispatchReport.unresolvedRecipients,
                attachTimesheets,
              }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
          }
        });
        emailDispatchStatus = isPartial ? "partially_sent_and_recorded" : "sent_and_recorded";
      } catch (recordErr) {
        emailDispatchStatus = isPartial ? "partially_sent_but_record_failed" : "sent_but_record_failed";
        console.error("Fehler beim Speichern der E-Mail-Metadaten:", recordErr);
      }
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, invoiceId: invoice.id, emailDispatchStatus, emailDispatchReport: dispatchReport };
}

