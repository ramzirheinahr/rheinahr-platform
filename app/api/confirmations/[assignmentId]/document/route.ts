import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

// Returns a short-lived signed URL (redirect) for an uploaded Leistungsnachweis
// document. Access: admin/super_admin, the owning client, or the assigned worker.
export async function GET(_req: Request, props: { params: Promise<{ assignmentId: string }> }) {
  const params = await props.params;
  const { assignmentId } = params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      serviceConfirmation: { select: { documentUrl: true } },
      order: { select: { clientId: true, client: { select: { userId: true } } } },
      worker: { select: { userId: true } },
    },
  });
  if (!a) return new NextResponse("Not found", { status: 404 });

  const url = new URL(_req.url);
  const documentId = url.searchParams.get("documentId");

  let path: string | null = null;
  if (documentId) {
    const doc = await prisma.confirmationDocument.findFirst({
      where: { id: documentId, assignmentId },
      select: { storagePath: true },
    });
    if (!doc || !doc.storagePath) {
      return new NextResponse("Dokument nicht gefunden", { status: 404 });
    }
    path = doc.storagePath;
  } else {
    const latestDoc = await prisma.confirmationDocument.findFirst({
      where: { assignmentId, storagePath: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { storagePath: true },
    });
    path = latestDoc?.storagePath || a?.serviceConfirmation?.documentUrl || null;
    if (!path) {
      return new NextResponse("Kein Dokument für diese Schicht hinterlegt", { status: 404 });
    }
  }

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

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from("confirmations")
    .createSignedUrl(path, 60);
  if (error || !data) return new NextResponse("Error", { status: 500 });

  await audit({
    userId: user.id,
    action: "document.view",
    entity: "Assignment",
    entityId: assignmentId,
  });

  return NextResponse.redirect(data.signedUrl);
}
