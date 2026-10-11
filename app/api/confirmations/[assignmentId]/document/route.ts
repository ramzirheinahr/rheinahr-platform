import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import fs from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getMimeTypeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

// Serves the Leistungsnachweis confirmation file (original or correction) directly
// by streaming the file bytes without exposing internal storage paths or redirecting
// to external storage signed URLs.
// Access: admin/super_admin, the owning client, or the assigned worker.
export async function GET(_req: Request, props: { params: Promise<{ assignmentId: string }> }) {
  const params = await props.params;
  const { assignmentId } = params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      serviceConfirmation: {
        select: {
          id: true,
          method: true,
          documentUrl: true,
          signatureData: true,
        },
      },
      order: {
        select: {
          clientId: true,
          shiftDate: true,
          client: { select: { userId: true } },
        },
      },
      worker: { select: { userId: true } },
    },
  });
  if (!a) return new NextResponse("Not found", { status: 404 });

  let allowed = false;
  if (roleSatisfies(user.role, ["admin"])) {
    allowed = true;
  } else if (a.worker.userId === user.id) {
    allowed = true;
  } else if (user.role === "client") {
    const { resolveClientId } = await import("@/lib/auth");
    const clientId = await resolveClientId(user);
    if (a.order.clientId === clientId) allowed = true;
  }

  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(_req.url);
  const documentId = url.searchParams.get("documentId");

  let storagePath: string | null = null;
  let fileName: string = `leistungsnachweis-${assignmentId}.pdf`;
  let mimeType: string = "application/pdf";
  let documentType: "original" | "correction" = "original";

  if (documentId === "original") {
    // Look for earliest ConfirmationDocument with sourceType == "electronic_original" or first created
    const originalDoc = await prisma.confirmationDocument.findFirst({
      where: {
        assignmentId,
        sourceType: "electronic_original",
        storagePath: { not: null },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, storagePath: true, fileName: true, mimeType: true },
    });

    if (originalDoc?.storagePath) {
      storagePath = originalDoc.storagePath;
      if (originalDoc.fileName) fileName = originalDoc.fileName;
      if (originalDoc.mimeType) mimeType = originalDoc.mimeType;
      documentType = "original";
    } else if (a.serviceConfirmation?.documentUrl) {
      // Fallback to legacy serviceConfirmation documentUrl
      storagePath = a.serviceConfirmation.documentUrl;
      fileName = storagePath.split("/").pop() || fileName;
      mimeType = getMimeTypeFromPath(storagePath);
      documentType = "original";
    } else {
      return new NextResponse("Originaldokument nicht gefunden", { status: 404 });
    }
  } else if (documentId) {
    if (documentId.startsWith("legacy-")) {
      storagePath = a.serviceConfirmation?.documentUrl || null;
      if (!storagePath) {
        return new NextResponse("Dokument nicht gefunden", { status: 404 });
      }
      fileName = storagePath.split("/").pop() || fileName;
      mimeType = getMimeTypeFromPath(storagePath);
      documentType = "original";
    } else {
      const doc = await prisma.confirmationDocument.findFirst({
        where: { id: documentId, assignmentId },
        select: {
          id: true,
          storagePath: true,
          fileName: true,
          mimeType: true,
          sourceType: true,
        },
      });
      if (!doc || !doc.storagePath) {
        return new NextResponse("Dokument nicht gefunden", { status: 404 });
      }
      storagePath = doc.storagePath;
      if (doc.fileName) fileName = doc.fileName;
      if (doc.mimeType) mimeType = doc.mimeType;
      documentType = doc.sourceType === "electronic_original" ? "original" : "correction";
    }
  } else {
    // Default to latest document or legacy serviceConfirmation document
    const latestDoc = await prisma.confirmationDocument.findFirst({
      where: { assignmentId, storagePath: { not: null } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        storagePath: true,
        fileName: true,
        mimeType: true,
        sourceType: true,
      },
    });

    if (latestDoc?.storagePath) {
      storagePath = latestDoc.storagePath;
      if (latestDoc.fileName) fileName = latestDoc.fileName;
      if (latestDoc.mimeType) mimeType = latestDoc.mimeType;
      documentType = latestDoc.sourceType === "electronic_original" ? "original" : "correction";
    } else if (a.serviceConfirmation?.documentUrl) {
      storagePath = a.serviceConfirmation.documentUrl;
      fileName = storagePath.split("/").pop() || fileName;
      mimeType = getMimeTypeFromPath(storagePath);
      documentType = "original";
    } else {
      return new NextResponse("Kein Dokument für diese Schicht hinterlegt", { status: 404 });
    }
  }

  // Stream bytes directly: handle local filesystem paths or Supabase storage
  let fileBuffer: Buffer | null = null;

  // Check if storagePath refers to a local file
  const isLocalFile = fs.existsSync(storagePath);
  if (isLocalFile) {
    try {
      fileBuffer = fs.readFileSync(storagePath);
    } catch {
      fileBuffer = null;
    }
  }

  if (!fileBuffer) {
    // Download directly from Supabase storage without exposing URL to client
    const cleanPath = storagePath.replace(/^\/?confirmations\//, "").replace(/^\//, "");
    try {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.storage.from("confirmations").download(cleanPath);
      if (!error && data) {
        const ab = await data.arrayBuffer();
        fileBuffer = Buffer.from(ab);
      }
    } catch {
      fileBuffer = null;
    }
  }

  if (!fileBuffer) {
    return new NextResponse("Das hinterlegte Dokument konnte nicht geladen werden.", {
      status: 404,
    });
  }

  await audit({
    userId: user.id,
    action: "document.view",
    entity: "Assignment",
    entityId: assignmentId,
    metadata: {
      documentType,
      fileName,
    },
  });

  const isDownload = url.searchParams.get("download") === "true";
  const disposition = isDownload ? "attachment" : "inline";

  return new NextResponse(new Uint8Array(fileBuffer), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `${disposition}; filename="${fileName}"`,
      "X-Document-Type": documentType,
      "Cache-Control": "no-store",
    },
  });
}
