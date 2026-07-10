import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function AdminContractsPage() {
  const t = await getTranslations("contracts");
  
  const contracts = await prisma.clientContract.findMany({
    include: {
      client: { select: { facilityName: true } },
      _count: { select: { assignments: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button render={<Link href="/admin/contracts/new" />} className="gap-2">
          <Plus className="size-4" />
          {t("generate")}
        </Button>
      </div>

      <div className="rounded-md border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="p-3 font-medium">Client</th>
              <th className="p-3 font-medium">Period</th>
              <th className="p-3 font-medium">Shifts</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  No contracts found.
                </td>
              </tr>
            ) : (
              contracts.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3 font-medium">{c.client.facilityName}</td>
                  <td className="p-3">{c.period || "-"}</td>
                  <td className="p-3">{c._count.assignments}</td>
                  <td className="p-3">
                    <Badge variant={c.status === "signed" ? "default" : "secondary"}>
                      {c.status === "signed" ? t("signed") : t("pending")}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {format(c.createdAt, "dd.MM.yyyy")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
