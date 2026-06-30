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

async function getClients() {
  try {
    return await prisma.client.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true } } },
    });
  } catch {
    return [];
  }
}

export default async function ClientsPage() {
  const t = await getTranslations("clients");
  const c = await getTranslations("common");
  const ef = await getTranslations("enums.facilityType");
  const clients = await getClients();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button
          render={<Link href="/admin/accounts/new?role=client" />}
          className="gap-2"
        >
          <Plus className="size-4" />
          {t("title")}
        </Button>
      </div>

      {clients.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("facilityName")}</TableHead>
                <TableHead>{t("facilityType")}</TableHead>
                <TableHead>{t("contactPerson")}</TableHead>
                <TableHead>{t("email")}</TableHead>
                <TableHead className="text-end">{c("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((cl) => (
                <TableRow key={cl.id}>
                  <TableCell className="font-medium">{cl.facilityName}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ef(cl.facilityType)}</Badge>
                  </TableCell>
                  <TableCell>{cl.contactPerson || c("none")}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {cl.user.email}
                  </TableCell>
                  <TableCell className="text-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2"
                      render={<Link href={`/admin/clients/${cl.id}/edit`} />}
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
