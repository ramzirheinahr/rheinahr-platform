import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AssignmentActions } from "@/components/worker/assignment-actions";
import { MessageSquare } from "lucide-react";

export const dynamic = "force-dynamic";

async function getAssignments() {
  const user = await getCurrentUser();
  if (!user) return [];
  try {
    const worker = await prisma.worker.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!worker) return [];
    return await prisma.assignment.findMany({
      where: { workerId: worker.id },
      orderBy: { order: { shiftDate: "asc" } },
      include: {
        order: {
          select: {
            shiftDate: true,
            startTime: true,
            endTime: true,
            requiredQualification: true,
            client: { select: { facilityName: true, address: true } },
          },
        },
      },
    });
  } catch {
    return [];
  }
}

export default async function WorkerAssignmentsPage() {
  const t = await getTranslations("orders");
  const eas = await getTranslations("enums.assignmentStatus");
  const tm = await getTranslations("messages");
  const assignments = await getAssignments();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("myAssignments")}</h1>

      {assignments.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("noAssignments")}
        </p>
      ) : (
        <div className="grid gap-4">
          {assignments.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{a.order.client.facilityName}</span>
                    <Badge
                      variant={
                        a.status === "confirmed"
                          ? "default"
                          : a.status === "declined"
                            ? "outline"
                            : "secondary"
                      }
                    >
                      {eas(a.status)}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {a.order.shiftDate.toISOString().slice(0, 10)} ·{" "}
                    {a.order.startTime}–{a.order.endTime}
                    {a.order.client.address ? ` · ${a.order.client.address}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {a.status === "pending" ? (
                    <AssignmentActions assignmentId={a.id} />
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    render={<Link href={`/worker/assignments/${a.id}`} />}
                  >
                    <MessageSquare className="size-4" />
                    {tm("chat")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
