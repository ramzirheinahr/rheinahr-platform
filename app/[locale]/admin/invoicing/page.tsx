import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InvoicingList } from "@/components/admin/invoicing-list";

export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(2, "0");
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export default async function InvoicingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("invoicing");

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const defFrom = `${y}-${pad(m + 1)}-01`;
  const defTo = `${y}-${pad(m + 1)}-${pad(new Date(Date.UTC(y, m + 1, 0)).getUTCDate())}`;
  const fromStr = sp.from && dateRegex.test(sp.from) ? sp.from : defFrom;
  const toStr = sp.to && dateRegex.test(sp.to) ? sp.to : defTo;

  const from = new Date(`${fromStr}T00:00:00.000Z`);
  const to = new Date(`${toStr}T23:59:59.999Z`);

  const invoices = await prisma.invoice.findMany({
    where: {
      date: { gte: from, lte: to }
    },
    include: {
      client: true
    },
    orderBy: { date: "desc" }
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Offizielle Rechnungen</h1>
        <p className="mt-1 text-sm text-muted-foreground">Verwalten Sie hier die erstellten Rechnungen an Ihre Kunden.</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="from">{t("from")}</Label>
          <Input id="from" name="from" type="date" defaultValue={fromStr} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="to">{t("to")}</Label>
          <Input id="to" name="to" type="date" defaultValue={toStr} />
        </div>
        <Button type="submit" variant="outline">
          {t("apply")}
        </Button>
      </form>

      <InvoicingList invoices={invoices} />
    </div>
  );
}
