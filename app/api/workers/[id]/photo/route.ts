import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { WORKER_FILES_BUCKET } from "@/lib/worker-files";

// Short-lived signed URL (redirect) for a worker's profile photo. Access: admin,
// the worker themselves, or a client who has the worker on one of their orders.
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const { id } = params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const worker = await prisma.worker.findUnique({
    where: { id },
    select: { photoPath: true, userId: true },
  });
  if (!worker?.photoPath) return new NextResponse("Not found", { status: 404 });

  let allowed = roleSatisfies(user.role, ["admin"]) || worker.userId === user.id;
  if (!allowed && user.role === "client") {
    const link = await prisma.assignment.findFirst({
      where: { workerId: id, order: { client: { userId: user.id } } },
      select: { id: true },
    });
    allowed = !!link;
  }
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(WORKER_FILES_BUCKET)
    .createSignedUrl(worker.photoPath, 300);
  if (error || !data) return new NextResponse("Error", { status: 500 });

  return NextResponse.redirect(data.signedUrl);
}
