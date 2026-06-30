import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

// Returns a short-lived signed URL (redirect) for an uploaded Leistungsnachweis
// document. Access: admin/super_admin, the owning client, or the assigned worker.
export async function GET(
  _req: Request,
  { params }: { params: { assignmentId: string } },
) {
  const { assignmentId } = params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      serviceConfirmation: { select: { documentUrl: true } },
      order: { select: { client: { select: { userId: true } } } },
      worker: { select: { userId: true } },
    },
  });
  const path = a?.serviceConfirmation?.documentUrl;
  if (!path) return new NextResponse("Not found", { status: 404 });

  const allowed =
    roleSatisfies(user.role, ["admin"]) ||
    a.order.client.userId === user.id ||
    a.worker.userId === user.id;
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
