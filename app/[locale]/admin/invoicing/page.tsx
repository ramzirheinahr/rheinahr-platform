import { getTranslations } from "next-intl/server";
import { getConfirmedServices, type InvoiceRow } from "@/lib/invoicing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Download } from "lucide-react";

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
  const eq = await getTranslations("enums.qualification");
  const ec = await getTranslations("confirmations");
  const cc = await getTranslations("common");

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const defFrom = `${y}-${pad(m + 1)}-01`;
  const defTo = `${y}-${pad(m + 1)}-${pad(new Date(Date.UTC(y, m + 1, 0)).getUTCDate())}`;
  const from = sp.from && dateRegex.test(sp.from) ? sp.from : defFrom;
  const to = sp.to && dateRegex.test(sp.to) ? sp.to : defTo;

  const rows = await getConfirmedServices({ from, to }).catch(() => []);
  const totalHours = rows.reduce((sum, r) => sum + r.hours, 0);
  const downloadHref = `/api/exports/confirmations?from=${from}&to=${to}`;

  const columns: Column<InvoiceRow>[] = [
    { header: t("date"), primary: true, cell: (r) => r.shiftDate },
    { header: t("facility"), cell: (r) => r.facilityName },
    { header: t("worker"), cell: (r) => r.workerName },
    { header: t("qualification"), cell: (r) => eq(r.qualification) },
    { header: t("hours"), className: "text-end", cell: (r) => r.hours },
    {
      header: t("method"),
      cell: (r) =>
        ec(r.method === "electronic" ? "methodElectronic" : "methodUpload"),
    },
    {
      header: cc("actions"),
      className: "text-end",
      action: true,
      cell: (r) => (
        <a
          href={`/api/confirmations/${r.assignmentId}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {ec("pdf")}
        </a>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="from">{t("from")}</Label>
          <Input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="to">{t("to")}</Label>
          <Input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <Button type="submit" variant="outline">
          {t("apply")}
        </Button>
        <Button render={<a href={downloadHref} download />} className="gap-2">
          <Download className="size-4" />
          {t("download")}
        </Button>
      </form>

      <ResponsiveTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.assignmentId}
        empty={t("empty")}
      />

      {rows.length > 0 ? (
        <div className="flex justify-end gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm font-semibold">
          <span>{t("totalHours")}:</span>
          <span>{totalHours}</span>
        </div>
      ) : null}
    </div>
  );
}
