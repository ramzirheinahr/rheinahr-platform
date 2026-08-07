import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatDateTimeDE } from "@/lib/utils";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { qualLabel } from "@/lib/invoicing";
import { netShiftHours } from "@/lib/pricing";
import { renderBulkLeistungsnachweisPdf, LeistungsnachweisData } from "@/lib/pdf/leistungsnachweis";
import { PDFDocument } from "pdf-lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids");
  
  if (!idsParam) {
    return new NextResponse("Bad Request: missing ids", { status: 400 });
  }

  const assignmentIds = idsParam.split(",").map(id => id.trim()).filter(Boolean);
  if (assignmentIds.length === 0) {
    return new NextResponse("Bad Request: empty ids", { status: 400 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const assignments = await prisma.assignment.findMany({
    where: { 
      id: { in: assignmentIds },
      status: "confirmed"
    },
    select: {
      id: true,
      status: true,
      worker: { select: { fullName: true, qualification: true, userId: true } },
      serviceConfirmation: {
        select: {
          method: true,
          documentUrl: true,
          hoursWorked: true,
          ipAddress: true,
          confirmedAt: true,
          signatureData: true,
          confirmedBy: { select: { email: true } }
        }
      },
      order: {
        select: {
          id: true,
          requestGroupId: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          breakMinutes: true,
          client: { select: { facilityName: true, userId: true } },
        },
      },
    },
    orderBy: { order: { shiftDate: "asc" } }
  });

  if (assignments.length === 0) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Ensure user has permission for ALL requested assignments
  const isAdmin = roleSatisfies(user.role, ["admin"]);
  for (const a of assignments) {
    const allowed = isAdmin || a.order.client.userId === user.id || a.worker.userId === user.id;
    if (!allowed) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createSupabaseAdminClient();
  const masterPdf = await PDFDocument.create();

  const generatedAssignments = assignments.filter(a => !(a.serviceConfirmation?.method === "upload" && a.serviceConfirmation?.documentUrl));
  const uploadedAssignments = assignments.filter(a => a.serviceConfirmation?.method === "upload" && a.serviceConfirmation?.documentUrl);

  if (generatedAssignments.length > 0) {
    const entries: LeistungsnachweisData[] = generatedAssignments.map(a => {
      // If it's already confirmed, use confirmed hours. Otherwise, use scheduled hours.
      const hours = a.serviceConfirmation 
        ? Number(a.serviceConfirmation.hoursWorked) 
        : netShiftHours(a.order.startTime, a.order.endTime, a.order.breakMinutes);
        
      const isElectronic = a.serviceConfirmation ? a.serviceConfirmation.method === "electronic" : false;
      const confirmedByEmail = a.serviceConfirmation ? (a.serviceConfirmation.confirmedBy?.email || "—") : "";
      const confirmedAt = a.serviceConfirmation ? formatDateTimeDE(a.serviceConfirmation.confirmedAt) : "";

      return {
        facilityName: a.order.client.facilityName,
        workerName: a.worker.fullName,
        qualificationLabel: qualLabel[a.worker.qualification],
        shiftDate: a.order.shiftDate.toISOString().slice(0, 10),
        startTime: a.order.startTime,
        endTime: a.order.endTime,
        hours,
        methodLabel: a.serviceConfirmation ? (a.serviceConfirmation.method === "electronic" ? "Elektronisch" : "Unterschrift (Handschriftlich)") : "Unterschrift (Handschriftlich)",
        isElectronic,
        signatureData: a.serviceConfirmation?.signatureData || null,
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

  // Ensure there's at least one page if somehow all assignments were empty or failed to load
  if (masterPdf.getPageCount() === 0) {
    masterPdf.addPage([595.28, 841.89]);
  }

  const pdfBytes = await masterPdf.save();

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="leistungsnachweise-bulk.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
