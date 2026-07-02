import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmServiceDialog } from "@/components/client/confirm-service-dialog";
import { Link } from "@/i18n/navigation";
import { CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

async function getConfirmableAssignments() {
  const user = await getCurrentUser();
  if (!user) return [];
  try {
    const client = await prisma.client.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!client) return [];
    return await prisma.assignment.findMany({
      where: { status: "confirmed", order: { clientId: client.id } },
      orderBy: { order: { shiftDate: "desc" } },
      include: {
        worker: { select: { id: true, fullName: true } },
        order: { select: { shiftDate: true, startTime: true, endTime: true } },
        serviceConfirmation: {
          select: { method: true, hoursWorked: true, confirmedAt: true },
        },
      },
    });
  } catch {
    return [];
  }
}

export default async function ConfirmationsPage() {
  const t = await getTranslations("confirmations");
  const em = await getTranslations("confirmations");
  const assignments = await getConfirmableAssignments();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {assignments.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="grid gap-4">
          {assignments.map((a) => {
            const sc = a.serviceConfirmation;
            return (
              <Card key={a.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                  <div className="space-y-1">
                    <Link
                      href={`/client/workers/${a.worker.id}`}
                      className="font-semibold underline-offset-2 hover:underline"
                    >
                      {a.worker.fullName}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {a.order.shiftDate.toISOString().slice(0, 10)} ·{" "}
                      {a.order.startTime}–{a.order.endTime}
                    </p>
                  </div>
                  {sc ? (
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="size-4 text-primary" />
                      <span>
                        {Number(sc.hoursWorked)}h ·{" "}
                        {em(
                          sc.method === "electronic"
                            ? "methodElectronic"
                            : "methodUpload",
                        )}
                      </span>
                      {sc.method === "upload" ? (
                        <a
                          href={`/api/confirmations/${a.id}/document`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2"
                        >
                          {em("viewDocument")}
                        </a>
                      ) : null}
                      <a
                        href={`/api/confirmations/${a.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        {em("pdf")}
                      </a>
                    </div>
                  ) : (
                    <ConfirmServiceDialog assignmentId={a.id} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
