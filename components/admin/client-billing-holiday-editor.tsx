"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveClientBillingHolidaysAction } from "@/app/[locale]/admin/clients/[id]/rates/actions";
import { billingHolidaysForYear, parseBillingHolidayCalendar, type BillingHoliday } from "@/lib/client-billing-holidays";

export function ClientBillingHolidayEditor({ clientId, expectedUpdatedAt, calendarValue }: {
  clientId: string;
  expectedUpdatedAt: string;
  calendarValue: unknown;
}) {
  const router = useRouter();
  const calendar = parseBillingHolidayCalendar(calendarValue);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<BillingHoliday[]>(() => billingHolidaysForYear(calendar, new Date().getFullYear()));
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  const update = (index: number, field: keyof BillingHoliday, value: string | boolean) => {
    setRows((previous) => previous.map((row, i) => i === index ? { ...row, [field]: value } : row));
    setDirty(true);
  };
  const changeYear = (next: number) => {
    if (!Number.isInteger(next) || next < 2020 || next > 2200) return;
    if (dirty && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
    setYear(next);
    setRows(billingHolidaysForYear(calendar, next));
    setDirty(false);
  };
  const save = () => startTransition(async () => {
    const result = await saveClientBillingHolidaysAction({ clientId, expectedUpdatedAt, year, rows });
    if (!result.ok) { toast.error(result.error); return; }
    setDirty(false);
    toast.success("Feiertagsregelung gespeichert.");
    router.refresh();
  });

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <Button type="button" variant="outline" onClick={() => setOpen((value) => !value)} className="gap-2">
        <CalendarDays className="size-4" /> Feiertage für Rechnungen {open ? "schließen" : "bearbeiten"}
      </Button>
      {open && <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Grundlage sind die Feiertage in Nordrhein-Westfalen. Diese Liste steuert ausschließlich den
          vertraglichen Feiertagszuschlag für neue Rechnungen dieses Kunden. Heiligabend und Silvester
          sind zunächst deaktiviert. Zeiten gelten am angegebenen Kalendertag; 24:00 bedeutet Mitternacht am Folgetag.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm font-medium">Jahr
            <select value={year} onChange={(event) => changeYear(Number(event.target.value))} className="block h-9 w-28 rounded-md border bg-background px-3">
              {Array.from({ length: 31 }, (_, index) => 2020 + index).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <span className="text-xs text-muted-foreground">{Object.hasOwn(calendar.years, String(year)) ? "Kundenspezifisch gespeichert" : "NRW-Vorlage (noch nicht gespeichert)"}</span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[700px] space-y-2">
            <div className="grid grid-cols-[4rem_10rem_minmax(10rem,1fr)_6rem_6rem_3rem] gap-2 text-xs font-semibold text-muted-foreground">
              <span>Aktiv</span><span>Datum</span><span>Bezeichnung</span><span>Von</span><span>Bis</span><span />
            </div>
            {rows.map((row, index) => <div key={index} className="grid grid-cols-[4rem_10rem_minmax(10rem,1fr)_6rem_6rem_3rem] items-center gap-2">
              <label className="flex justify-center"><input type="checkbox" checked={row.active} onChange={(event) => update(index, "active", event.target.checked)} aria-label={`${row.name} berechnen`} /></label>
              <Input type="date" value={row.date} min={`${year}-01-01`} max={`${year}-12-31`} onChange={(event) => update(index, "date", event.target.value)} aria-label="Datum" />
              <Input value={row.name} maxLength={120} onChange={(event) => update(index, "name", event.target.value)} aria-label="Bezeichnung" />
              <Input value={row.start} placeholder="00:00" onChange={(event) => update(index, "start", event.target.value)} aria-label="Beginn" />
              <Input value={row.end} placeholder="24:00" onChange={(event) => update(index, "end", event.target.value)} aria-label="Ende" />
              <Button type="button" variant="ghost" size="icon" onClick={() => { setRows((previous) => previous.filter((_, i) => i !== index)); setDirty(true); }} aria-label={`${row.name} entfernen`}><Trash2 className="size-4" /></Button>
            </div>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => { setRows((previous) => [...previous, { date: `${year}-01-01`, name: "Neuer Tag", start: "00:00", end: "24:00", active: true }]); setDirty(true); }} className="gap-2"><Plus className="size-4" /> Tag hinzufügen</Button>
          <Button type="button" onClick={save} disabled={pending || !dirty}>Feiertage speichern</Button>
        </div>
      </div>}
    </div>
  );
}
