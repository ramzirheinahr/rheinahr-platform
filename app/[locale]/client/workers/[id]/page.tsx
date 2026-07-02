import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getWorkerProfileData } from "@/lib/worker-profile";
import { WorkerProfile } from "@/components/worker/worker-profile";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// A client may view a worker's profile only if that worker is on one of their
// orders (assignment link). Otherwise the page 404s (no enumeration).
export default async function ClientWorkerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const c = await getTranslations("common");

  const user = await getCurrentUser();
  if (!user) notFound();

  const link = await prisma.assignment
    .findFirst({
      where: { workerId: id, order: { client: { userId: user.id } } },
      select: { id: true },
    })
    .catch(() => null);
  if (!link) notFound();

  const data = await getWorkerProfileData(id);
  if (!data) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <Button
        variant="ghost"
        size="sm"
        className="gap-2"
        render={<Link href="/client/orders" />}
      >
        <ArrowLeft className="size-4" />
        {c("back")}
      </Button>
      <WorkerProfile data={data} />
    </div>
  );
}
