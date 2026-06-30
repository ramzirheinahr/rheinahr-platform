import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

async function getWorkers() {
  try {
    return await prisma.worker.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true } } },
    });
  } catch {
    return [];
  }
}

export default async function WorkersPage() {
  const t = await getTranslations("workers");
  const c = await getTranslations("common");
  const eq = await getTranslations("enums.qualification");
  const ec = await getTranslations("enums.contractType");
  const workers = await getWorkers();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button
          render={<Link href="/admin/accounts/new?role=worker" />}
          className="gap-2"
        >
          <Plus className="size-4" />
          {t("new")}
        </Button>
      </div>

      {workers.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fullName")}</TableHead>
                <TableHead>{t("email")}</TableHead>
                <TableHead>{t("qualification")}</TableHead>
                <TableHead>{t("contractType")}</TableHead>
                <TableHead>{t("phone")}</TableHead>
                <TableHead className="text-end">{c("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">{w.fullName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {w.user.email}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{eq(w.qualification)}</Badge>
                  </TableCell>
                  <TableCell>{ec(w.contractType)}</TableCell>
                  <TableCell>{w.phone || c("none")}</TableCell>
                  <TableCell className="text-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2"
                      render={<Link href={`/admin/workers/${w.id}/edit`} />}
                    >
                      <Pencil className="size-4" />
                      {c("edit")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
