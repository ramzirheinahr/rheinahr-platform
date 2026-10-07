import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { generateLeistungsnachweisePdf } from "@/lib/pdf/generate-timesheets-pdf";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { WORKER_FILES_BUCKET } from "@/lib/worker-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const filename = url.searchParams.get("filename")?.trim();
  if (!filename) {
    return new NextResponse("Filename is required", { status: 400 });
  }

  const email = await prisma.outgoingEmail.findUnique({
    where: { id },
  });
  if (!email) {
    return new NextResponse("Email not found", { status: 404 });
  }

  // Authorization: Admins or the recipient themselves
  const isAllowed =
    roleSatisfies(user.role, ["admin"]) ||
    (user.email && email.to.toLowerCase() === user.email.toLowerCase()) ||
    (email.userId && email.userId === user.id);

  if (!isAllowed) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const attachments = (email.attachments as any[]) || [];
  const foundAttachment = attachments.find((a) => a.filename === filename);
  if (!foundAttachment && attachments.length > 0) {
    // Check if filename loosely matches
    const loose = attachments.find(
      (a) => a.filename.toLowerCase() === filename.toLowerCase()
    );
    if (!loose) {
      return new NextResponse("Attachment not found in this email record", { status: 404 });
    }
  }

  // Case 1: Leistungsnachweise PDF (e.g. Leistungsnachweise_590-116-0926.pdf)
  const isTimesheet = filename.toLowerCase().includes("leistungsnachweis");
  if (isTimesheet) {
    // Extract invoice number from filename (e.g. 590-116-0926) or fallback to email subject
    const invMatch =
      filename.match(/(\d{3}-\d{3}-\d{4})/i) ||
      email.subject.match(/(\d{3}-\d{3}-\d{4})/i);

    if (invMatch) {
      const invoiceNumber = invMatch[1];
      const invoice = await prisma.invoice.findFirst({
        where: { invoiceNumber },
        include: {
          assignments: {
            select: { id: true },
          },
        },
      });

      if (invoice && invoice.assignments.length > 0) {
        const assignmentIds = invoice.assignments.map((a) => a.id);
        const timesheetBuffer = await generateLeistungsnachweisePdf(assignmentIds);
        if (timesheetBuffer) {
          return new NextResponse(new Uint8Array(timesheetBuffer), {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `inline; filename="${filename}"`,
              "Cache-Control": "no-store",
            },
          });
        }
      }
    }
  }

  // Case 2: Invoice PDF (e.g. 590-116-0926.pdf or Rechnung-590-116-0926.pdf)
  const invoiceNumberMatch =
    filename.match(/(\d{3}-\d{3}-\d{4})/i) ||
    email.subject.match(/(\d{3}-\d{3}-\d{4})/i);

  if (invoiceNumberMatch && !isTimesheet) {
    const invoiceNumber = invoiceNumberMatch[1];
    const invoice = await prisma.invoice.findFirst({
      where: { invoiceNumber },
      include: {
        client: true,
        assignments: {
          include: {
            worker: true,
            order: true,
          },
          orderBy: { order: { shiftDate: "asc" } },
        },
      },
    });

    if (invoice) {
      const pdfData = buildInvoicePdfData(invoice, invoice.client, invoice.assignments);
      const pdfBuffer = await generateInvoicePdf(pdfData);

      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }
  }

  // Case 3: Worker Certificate or Document (e.g. Zertifikat_Al_Hechmi,_Mohammad.pdf or Demirtaş, özlem.pdf)
  const cleanNameCandidate = filename
    .replace(/^Zertifikat_/i, "")
    .replace(/\.[^/.]+$/, "")
    .replace(/_/g, " ")
    .trim();

  if (cleanNameCandidate.length >= 2) {
    // Try to find worker document
    const worker = await prisma.worker.findFirst({
      where: {
        OR: [
          { fullName: { contains: cleanNameCandidate, mode: "insensitive" } },
          {
            documents: {
              some: {
                fileName: { contains: cleanNameCandidate, mode: "insensitive" },
              },
            },
          },
        ],
      },
      include: {
        documents: {
          orderBy: { uploadedAt: "desc" },
        },
      },
    });

    if (worker && worker.documents.length > 0) {
      // Find matching document or latest certificate
      const doc =
        worker.documents.find((d) =>
          d.fileName.toLowerCase().includes(cleanNameCandidate.toLowerCase())
        ) || worker.documents[0];

      try {
        const supabase = createSupabaseAdminClient();
        const { data, error } = await supabase.storage
          .from(WORKER_FILES_BUCKET)
          .download(doc.filePath);

        if (data && !error) {
          const buf = Buffer.from(await data.arrayBuffer());
          const contentType =
            data.type ||
            (doc.fileName.endsWith(".pdf") ? "application/pdf" : "application/octet-stream");

          return new NextResponse(new Uint8Array(buf), {
            headers: {
              "Content-Type": contentType,
              "Content-Disposition": `inline; filename="${filename}"`,
              "Cache-Control": "no-store",
            },
          });
        }
      } catch (err) {
        console.error("Failed to download worker document from storage:", err);
      }
    }
  }

  return new NextResponse(
    `Attachment '${filename}' could not be dynamically resolved or retrieved from storage.`,
    { status: 404 }
  );
}
