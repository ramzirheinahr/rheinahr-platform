import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { WORKER_FILES_BUCKET } from "@/lib/worker-files";

// Short-lived signed URL (redirect) for a worker's uploaded document. Access:
// admin or the worker themselves — clients never see the raw certificate files.
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const { id } = params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const doc = await prisma.workerDocument.findUnique({
    where: { id },
    select: { filePath: true, workerId: true, worker: { select: { userId: true } } },
  });
  if (!doc) return new NextResponse("Not found", { status: 404 });

  let allowed =
    roleSatisfies(user.role, ["admin"]) || doc.worker.userId === user.id;
  if (!allowed && user.role === "client") {
    const link = await prisma.assignment.findFirst({
      where: { workerId: doc.workerId, order: { client: { userId: user.id } } },
      select: { id: true },
    });
    allowed = !!link;
  }
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(WORKER_FILES_BUCKET)
    .createSignedUrl(doc.filePath, 60);
  if (error || !data) return new NextResponse("Error", { status: 500 });

  await audit({
    userId: user.id,
    action: "worker.document.view",
    entity: "WorkerDocument",
    entityId: id,
  });

  return NextResponse.redirect(data.signedUrl);
}
