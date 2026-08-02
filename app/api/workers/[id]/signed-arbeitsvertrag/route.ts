import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { WORKER_FILES_BUCKET } from "@/lib/worker-files";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const worker = await prisma.worker.findUnique({
    where: { id: params.id },
    select: { arbeitsvertragUrl: true },
  });

  if (!worker?.arbeitsvertragUrl) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (worker.arbeitsvertragUrl.startsWith("/")) {
    return new NextResponse("Old local file cannot be retrieved", { status: 404 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(WORKER_FILES_BUCKET)
    .createSignedUrl(worker.arbeitsvertragUrl, 300);

  if (error || !data) {
    return new NextResponse("Error generating signed URL", { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl);
}
