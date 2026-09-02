import { prisma } from "@/lib/prisma";
import { formatDateTimeDE } from "@/lib/utils";
import { qualLabel } from "@/lib/invoicing";
import { netShiftHours } from "@/lib/pricing";
import { renderBulkLeistungsnachweisPdf, LeistungsnachweisData } from "@/lib/pdf/leistungsnachweis";
import { PDFDocument } from "pdf-lib";
import type { Qualification } from "@/lib/validations";

/**
 * Generates a unified, multi-page PDF buffer of shift confirmations (Leistungsnachweise)
 * for the provided assignment IDs.
 * 
 * It automatically handles:
 * 1. Electronically signed confirmations (with signature, IP, timestamp, signer name).
 * 2. Unconfirmed / draft shifts (with scheduled hours, facility, worker, and empty signature line).
 * 3. Uploaded paper timesheets (PDFs copied page-by-page, images embedded on A4 pages).
 */
export async function generateLeistungsnachweisePdf(
  assignmentIds: string[]
): Promise<Buffer | null> {
  if (!assignmentIds || assignmentIds.length === 0) {
    return null;
  }

  const assignments = await prisma.assignment.findMany({
    where: {
      id: { in: assignmentIds },
    },
    select: {
      id: true,
      status: true,
      worker: {
        select: {
          fullName: true,
          qualification: true,
          userId: true,
        },
      },
      serviceConfirmation: {
        select: {
          method: true,
          documentUrl: true,
          hoursWorked: true,
          ipAddress: true,
          confirmedAt: true,
          signatureData: true,
          signerName: true,
          confirmedBy: { select: { email: true } },
        },
      },
      order: {
        select: {
          id: true,
          requestGroupId: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          breakMinutes: true,
          requiredQualification: true,
          client: {
            select: {
              facilityName: true,
              userId: true,
            },
          },
        },
      },
    },
    orderBy: { order: { shiftDate: "asc" } },
  });

  if (assignments.length === 0) {
    return null;
  }

  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createSupabaseAdminClient();
  const masterPdf = await PDFDocument.create();

  const generatedAssignments = assignments.filter(
    (a) => !(a.serviceConfirmation?.method === "upload" && a.serviceConfirmation?.documentUrl)
  );
  const uploadedAssignments = assignments.filter(
    (a) => a.serviceConfirmation?.method === "upload" && a.serviceConfirmation?.documentUrl
  );

  if (generatedAssignments.length > 0) {
    const entries: LeistungsnachweisData[] = generatedAssignments.map((a) => {
      const hours = a.serviceConfirmation
        ? Number(a.serviceConfirmation.hoursWorked)
        : netShiftHours(a.order.startTime, a.order.endTime, a.order.breakMinutes);

      const isElectronic = a.serviceConfirmation ? a.serviceConfirmation.method === "electronic" : false;
      const confirmedByEmail = a.serviceConfirmation
        ? a.serviceConfirmation.confirmedBy?.email || "—"
        : "";
      const confirmedAt = a.serviceConfirmation
        ? formatDateTimeDE(a.serviceConfirmation.confirmedAt)
        : "";

      const rawQual = (a.worker?.qualification || a.order?.requiredQualification) as Qualification;
      const qLabel = qualLabel[rawQual] || rawQual || "Pflegekraft";

      return {
        facilityName: a.order.client.facilityName,
        workerName: a.worker?.fullName || "—",
        qualificationLabel: qLabel,
        shiftDate: a.order.shiftDate.toISOString().slice(0, 10),
        startTime: a.order.startTime,
        endTime: a.order.endTime,
        hours,
        methodLabel: a.serviceConfirmation
          ? a.serviceConfirmation.method === "electronic"
            ? "Elektronisch"
            : "Unterschrift (Handschriftlich)"
          : "Unterschrift (Handschriftlich)",
        isElectronic,
        signatureData: a.serviceConfirmation?.signatureData || null,
        signerName: a.serviceConfirmation?.signerName || null,
        confirmedByEmail,
        confirmedAt,
        ipAddress: a.serviceConfirmation?.ipAddress || null,
        orderId: a.order.id,
        assignmentId: a.id,
        draft: !a.serviceConfirmation,
      };
    });

    const generatedBuffer = await renderBulkLeistungsnachweisPdf(entries);
    const generatedPdf = await PDFDocument.load(generatedBuffer);
    const copiedPages = await masterPdf.copyPages(generatedPdf, generatedPdf.getPageIndices());
    copiedPages.forEach((page) => masterPdf.addPage(page));
  }

  // Append uploaded documents
  for (const a of uploadedAssignments) {
    const docUrl = a.serviceConfirmation!.documentUrl!;
    const { data, error } = await supabase.storage.from("confirmations").download(docUrl);

    if (error || !data) {
      console.error(`Failed to download ${docUrl}:`, error);
      continue;
    }

    const arrayBuffer = await data.arrayBuffer();

    try {
      if (data.type === "application/pdf" || docUrl.toLowerCase().endsWith(".pdf")) {
        const externalDoc = await PDFDocument.load(arrayBuffer);
        const copiedPages = await masterPdf.copyPages(externalDoc, externalDoc.getPageIndices());
        copiedPages.forEach((page) => masterPdf.addPage(page));
      } else if (data.type.startsWith("image/") || docUrl.match(/\.(jpeg|jpg|png)$/i)) {
        let image;
        if (data.type === "image/png" || docUrl.toLowerCase().endsWith(".png")) {
          image = await masterPdf.embedPng(arrayBuffer);
        } else {
          image = await masterPdf.embedJpg(arrayBuffer);
        }

        // Create an A4 page (595.28 x 841.89 points)
        const page = masterPdf.addPage([595.28, 841.89]);

        // Calculate dimensions to fit the image on the page with margins
        const { width, height } = page.getSize();
        const margin = 50;
        const maxWidth = width - margin * 2;
        const maxHeight = height - margin * 2;

        const imgDims = image.scaleToFit(maxWidth, maxHeight);

        page.drawImage(image, {
          x: width / 2 - imgDims.width / 2,
          y: height / 2 - imgDims.height / 2,
          width: imgDims.width,
          height: imgDims.height,
        });
      }
    } catch (err) {
      console.error(`Error embedding document ${docUrl} into bulk PDF:`, err);
    }
  }

  if (masterPdf.getPageCount() === 0) {
    return null;
  }

  const pdfBytes = await masterPdf.save();
  return Buffer.from(pdfBytes);
}
