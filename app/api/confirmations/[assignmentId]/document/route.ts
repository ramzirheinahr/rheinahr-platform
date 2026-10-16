import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { createLocalStorageClient } from "@/lib/local-storage";
import { audit } from "@/lib/audit";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB max

function getAllowedLocalRoots(): string[] {
  const roots: string[] = [
    path.resolve(process.cwd(), "public", "uploads", "confirmations"),
    path.resolve(process.cwd(), "storage", "confirmations"),
  ];
  if (process.env.CONFIRMATIONS_STORAGE_DIR) {
    roots.push(path.resolve(process.env.CONFIRMATIONS_STORAGE_DIR));
  }
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    roots.push(path.resolve(os.tmpdir()));
  }
  return roots;
}

function readLocalFileIfAllowed(filePath: string): Buffer | null {
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return null;

    const canonical = fs.realpathSync(resolved);
    const allowedRoots = getAllowedLocalRoots();

    const isInsideAllowedRoot = allowedRoots.some((root) => {
      try {
        const canonicalRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
        return canonical === canonicalRoot || canonical.startsWith(canonicalRoot + path.sep);
      } catch {
        return false;
      }
    });

    if (!isInsideAllowedRoot) return null;

    const stat = fs.statSync(canonical);
    if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return null;

    return fs.readFileSync(canonical);
  } catch {
    return null;
  }
}

async function downloadFromStorage(storagePath: string): Promise<Buffer | null> {
  const cleanPath = storagePath
    .replace(/^\/?confirmations\//, "")
    .replace(/^\//, "")
    .replace(/\.\./g, "");

  try {
    const supabase = createLocalStorageClient();
    const { data, error } = await supabase.storage.from("confirmations").download(cleanPath);
    if (error || !data) return null;

    const ab = await data.arrayBuffer();
    if (ab.byteLength > MAX_FILE_SIZE) return null;

    return Buffer.from(ab);
  } catch {
    return null;
  }
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

  let targetDoc: {
    id: string;
    storagePath: string | null;
    fileName: string | null;
    mimeType: string | null;
    sourceType: string;
    createdAt?: Date;
  } | null = null;

  let storagePath: string | null = null;
  let fileName: string = `leistungsnachweis-${assignmentId}.pdf`;
  let mimeType: string = "application/pdf";
  let documentType: "original" | "correction" = "original";

  if (documentId === "original") {
    // Look for earliest ConfirmationDocument with sourceType in ["electronic_original", "manual_upload"]
    const originalDoc = await prisma.confirmationDocument.findFirst({
      where: {
        assignmentId,
        sourceType: { in: ["electronic_original", "manual_upload"] },
        storagePath: { not: null },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        storagePath: true,
        fileName: true,
        mimeType: true,
        sourceType: true,
        createdAt: true,
      },
    });

    if (originalDoc?.storagePath) {
      targetDoc = originalDoc;
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
          createdAt: true,
        },
      });
      if (!doc || !doc.storagePath) {
        return new NextResponse("Dokument nicht gefunden", { status: 404 });
      }
      targetDoc = doc;
      storagePath = doc.storagePath;
      if (doc.fileName) fileName = doc.fileName;
      if (doc.mimeType) mimeType = doc.mimeType;

      if (doc.sourceType === "electronic_original") {
        documentType = "original";
      } else if (doc.sourceType === "manual_upload") {
        // Earliest document on this assignment is the original
        const earlierDoc = await prisma.confirmationDocument.findFirst({
          where: {
            assignmentId,
            id: { not: doc.id },
            createdAt: { lt: doc.createdAt },
          },
        });
        documentType = !earlierDoc ? "original" : "correction";
      } else {
        documentType = "correction";
      }
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
        createdAt: true,
      },
    });

    if (latestDoc?.storagePath) {
      targetDoc = latestDoc;
      storagePath = latestDoc.storagePath;
      if (latestDoc.fileName) fileName = latestDoc.fileName;
      if (latestDoc.mimeType) mimeType = latestDoc.mimeType;

      if (latestDoc.sourceType === "electronic_original") {
        documentType = "original";
      } else if (latestDoc.sourceType === "manual_upload") {
        const earlierDoc = await prisma.confirmationDocument.findFirst({
          where: {
            assignmentId,
            id: { not: latestDoc.id },
            createdAt: { lt: latestDoc.createdAt },
          },
        });
        documentType = !earlierDoc ? "original" : "correction";
      } else {
        documentType = "correction";
      }
    } else if (a.serviceConfirmation?.documentUrl) {
      storagePath = a.serviceConfirmation.documentUrl;
      fileName = storagePath.split("/").pop() || fileName;
      mimeType = getMimeTypeFromPath(storagePath);
      documentType = "original";
    } else {
      return new NextResponse("Kein Dokument für diese Schicht hinterlegt", { status: 404 });
    }
  }

  // Separate document type from correction approval status
  // Strictly and exclusively derived from WorkHoursCorrectionRequest linked to targetDoc.id
  let correctionStatus: "approved" | "proposed" | "rejected" | "none" = "none";
  let isCorrectionApproved = false;

  if (targetDoc) {
    const corrRequest = await prisma.workHoursCorrectionRequest.findFirst({
      where: {
        assignmentId,
        documentId: targetDoc.id,
      },
      select: { status: true },
    });

    if (corrRequest) {
      correctionStatus = corrRequest.status;
      isCorrectionApproved = corrRequest.status === "approved";
    }
  }

  // Sanitize fileName for Content-Disposition
  const sanitizedFileName = (fileName || `leistungsnachweis-${assignmentId}.pdf`)
    .replace(/[\r\n"/\\]/g, "")
    .replace(/\.\.+/g, "_")
    .replace(/^\.+/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100);

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
    return new NextResponse("Nicht unterstützter Dateityp", { status: 415 });
  }

  // Stream bytes directly from restricted local storage.
  let fileBuffer = readLocalFileIfAllowed(storagePath);
  if (!fileBuffer) {
    fileBuffer = await downloadFromStorage(storagePath);
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
      fileName: sanitizedFileName,
      sourceType: targetDoc?.sourceType || "legacy_document",
      correctionStatus,
      isCorrectionApproved,
    },
  });

  const isDownload = url.searchParams.get("download") === "true";
  const disposition = isDownload ? "attachment" : "inline";

  return new NextResponse(new Uint8Array(fileBuffer), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `${disposition}; filename="${sanitizedFileName}"`,
      "X-Document-Type": documentType,
      "X-Document-Source-Type": targetDoc?.sourceType || "legacy_document",
      "X-Correction-Status": correctionStatus,
      "X-Correction-Approved": String(isCorrectionApproved),
      "Cache-Control": "no-store",
    },
  });
}
