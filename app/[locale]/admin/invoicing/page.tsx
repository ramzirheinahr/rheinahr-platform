import { getTranslations } from "next-intl/server";
import { getConfirmedServices } from "@/lib/invoicing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("date")}</TableHead>
              <TableHead>{t("facility")}</TableHead>
              <TableHead>{t("worker")}</TableHead>
              <TableHead>{t("qualification")}</TableHead>
              <TableHead className="text-end">{t("hours")}</TableHead>
              <TableHead>{t("method")}</TableHead>
              <TableHead className="text-end">{cc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : (
              <>
                {rows.map((r) => (
                  <TableRow key={r.assignmentId}>
                    <TableCell>{r.shiftDate}</TableCell>
                    <TableCell className="font-medium">{r.facilityName}</TableCell>
                    <TableCell>{r.workerName}</TableCell>
                    <TableCell>{eq(r.qualification)}</TableCell>
                    <TableCell className="text-end">{r.hours}</TableCell>
                    <TableCell>
                      {ec(r.method === "electronic" ? "methodElectronic" : "methodUpload")}
                    </TableCell>
                    <TableCell className="text-end">
                      <a
                        href={`/api/confirmations/${r.assignmentId}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-2"
                      >
                        {ec("pdf")}
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={4} className="text-end font-semibold">
                    {t("totalHours")}
                  </TableCell>
                  <TableCell className="text-end font-semibold">{totalHours}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
