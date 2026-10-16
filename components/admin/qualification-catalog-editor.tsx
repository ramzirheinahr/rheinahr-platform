"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createQualificationAction, updateQualificationAction } from "@/app/[locale]/admin/settings/system/qualification-actions";
type Row = {
  code: string; nameDe: string; nameEn: string; nameAr: string;
  defaultClientRateCents: number | null; active: boolean; sortOrder: number; updatedAt: string;
};

function qualificationName(item: Row, locale: string): string {
  return locale === "ar" ? item.nameAr : locale === "en" ? item.nameEn : item.nameDe;
}

function centsFromInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [euros, cents = ""] = normalized.split(".");
  return Number(euros) * 100 + Number(cents.padEnd(2, "0"));
}

function euros(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

export function QualificationCatalogEditor({ initialRows }: { initialRows: Row[] }) {
  const t = useTranslations("qualificationCatalog");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState(initialRows);
  const [prices, setPrices] = useState<Record<string, string>>(
    Object.fromEntries(initialRows.map((item) => [item.code, euros(item.defaultClientRateCents)])),
  );
  const [newRow, setNewRow] = useState({ code: "", nameDe: "", nameEn: "", nameAr: "", price: "" });

  const submitNew = (event: React.FormEvent) => {
    event.preventDefault();
    const defaultClientRateCents = centsFromInput(newRow.price);
    if (defaultClientRateCents === null || defaultClientRateCents <= 0) { toast.error(t("invalidPrice")); return; }
    startTransition(async () => {
      const result = await createQualificationAction({
        code: newRow.code, nameDe: newRow.nameDe, nameEn: newRow.nameEn, nameAr: newRow.nameAr,
        defaultClientRateCents,
      });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(t("saved"));
      setNewRow({ code: "", nameDe: "", nameEn: "", nameAr: "", price: "" });
      router.refresh();
    });
  };

  const saveRow = (row: Row, active = row.active) => {
    const defaultClientRateCents = centsFromInput(prices[row.code] ?? "");
    if ((defaultClientRateCents === null && active) || (defaultClientRateCents !== null && defaultClientRateCents <= 0)) { toast.error(t("invalidPrice")); return; }
    startTransition(async () => {
      const result = await updateQualificationAction({
        code: row.code, expectedUpdatedAt: row.updatedAt,
        nameDe: row.nameDe, nameEn: row.nameEn, nameAr: row.nameAr,
        defaultClientRateCents,
        sortOrder: row.sortOrder, active,
      });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(t("saved"));
      router.refresh();
    });
  };

  const changeRow = (code: string, key: "nameDe" | "nameEn" | "nameAr" | "sortOrder", value: string) => {
    setRows((previous) => previous.map((item) => item.code === code ? { ...item, [key]: key === "sortOrder" ? Number(value) : value } : item));
  };

  return (
    <section className="space-y-5 rounded-xl border p-4 sm:p-6">
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="space-y-4">
        {rows.map((row) => (
          <div key={row.code} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{qualificationName(row, locale)}</div>
                <div className="text-xs text-muted-foreground">{row.code} · {row.active ? t("active") : t("archived")}</div>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={pending} onClick={() => saveRow(row)}>{t("save")}</Button>
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => saveRow(row, !row.active)}>
                  {row.active ? t("archive") : t("reactivate")}
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(["nameDe", "nameEn", "nameAr"] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`${row.code}-${key}`}>{t(key)}</Label>
                  <Input id={`${row.code}-${key}`} maxLength={120} value={row[key]} onChange={(event) => changeRow(row.code, key, event.target.value)} />
                </div>
              ))}
              <div className="space-y-1">
                <Label htmlFor={`${row.code}-price`}>{t("defaultRate")}</Label>
                <Input id={`${row.code}-price`} inputMode="decimal" value={prices[row.code] ?? ""} onChange={(event) => setPrices((old) => ({ ...old, [row.code]: event.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${row.code}-order`}>{t("sortOrder")}</Label>
                <Input id={`${row.code}-order`} type="number" min="0" step="1" value={row.sortOrder} onChange={(event) => changeRow(row.code, "sortOrder", event.target.value)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={submitNew} className="space-y-3 rounded-lg border p-4">
        <h3 className="font-semibold">{t("addTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("codeHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(["code", "nameDe", "nameEn", "nameAr"] as const).map((key) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`new-${key}`}>{t(key)}</Label>
              <Input id={`new-${key}`} required value={newRow[key]} onChange={(event) => setNewRow((old) => ({ ...old, [key]: event.target.value }))} />
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor="new-price">{t("defaultRate")}</Label>
            <Input id="new-price" required inputMode="decimal" value={newRow.price} onChange={(event) => setNewRow((old) => ({ ...old, price: event.target.value }))} />
          </div>
        </div>
        <Button type="submit" disabled={pending}>{t("add")}</Button>
      </form>
    </section>
  );
}
