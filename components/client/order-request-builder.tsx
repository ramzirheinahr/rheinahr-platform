"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { qualifications } from "@/lib/validations";
import { germanHolidays } from "@/lib/holidays";
import { createOrderRequest } from "@/app/[locale]/client/orders/actions";
import { Save, Plus, X } from "lucide-react";

type Qual = (typeof qualifications)[number];
type ShiftType = "none" | "early" | "late" | "night";
type Cell = {
  type: ShiftType;
  start: string;
  end: string;
  pause: number; // break in minutes
  quantity: number;
  bereich: string;
};

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
// Net work hours = shift duration (overnight-aware) minus the break.
function netHours(start: string, end: string, pause: number): number | null {
  if (!start || !end) return null;
  let dur = (toMin(end) - toMin(start) + 1440) % 1440;
  if (dur === 0) dur = 1440;
  const net = (dur - pause) / 60;
  return net > 0 ? net : 0;
}

const PRESETS = [
  { key: "early", start: "06:30", end: "14:00" },
  { key: "late", start: "13:30", end: "21:00" },
  { key: "night", start: "20:30", end: "07:00" },
] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const EMPTY: Cell = { type: "none", start: "", end: "", pause: 30, quantity: 1, bereich: "" };
const field =
  "w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50";

export function OrderRequestBuilder() {
  const t = useTranslations("orderRequest");
  const o = useTranslations("orders");
  const c = useTranslations("common");
  const eq = useTranslations("enums.qualification");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const now = new Date();
  const thisYear = now.getUTCFullYear();
  const todayStr = now.toISOString().slice(0, 10);

  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(now.getUTCMonth() + 1); // 1-12
  const [qual, setQual] = useState<Qual>(qualifications[0]);
  const [cells, setCells] = useState<Record<string, Cell>>({});
  // Visible shift rows per day (1 by default, up to 3 via the + button).
  const [slotCounts, setSlotCounts] = useState<Record<string, number>>({});
  // Remount key per cell — bumped only when a preset/clear changes the times, so
  // the uncontrolled <input type="time"> isn't reset mid-typing.
  const [ver, setVer] = useState<Record<string, number>>({});
  const bump = (date: string, slot: number) =>
    setVer((p) => {
      const k = `${date}:${slot}`;
      return { ...p, [k]: (p[k] ?? 0) + 1 };
    });

  const holidays = useMemo(() => germanHolidays(year), [year]);
  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) =>
        new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
          new Date(Date.UTC(2020, i, 1)),
        ),
      ),
    [locale],
  );

  const days = useMemo(() => {
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const wd = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
    return Array.from({ length: count }, (_, i) => {
      const d = i + 1;
      const date = `${year}-${pad(month)}-${pad(d)}`;
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      return {
        date,
        label: `${wd.format(new Date(`${date}T00:00:00Z`))} ${pad(d)}.${pad(month)}.`,
        weekend: dow === 0 || dow === 6,
        holiday: holidays.get(date),
        past: date < todayStr,
        isWeekday: dow >= 1 && dow <= 5,
      };
    });
  }, [year, month, locale, holidays, todayStr]);

  const get = (date: string, slot: number): Cell => cells[`${date}:${slot}`] ?? EMPTY;

  function update(date: string, slot: number, patch: Partial<Cell>) {
    const key = `${date}:${slot}`;
    setCells((prev) => ({
      ...prev,
      [key]: { ...EMPTY, ...prev[key], ...patch },
    }));
  }
  function clear(date: string, slot: number) {
    setCells((prev) => {
      const n = { ...prev };
      delete n[`${date}:${slot}`];
      return n;
    });
  }
  // Effective number of shift rows for a day: the chosen count, but never fewer
  // than needed to show already-filled shifts.
  function effCount(date: string) {
    let n = slotCounts[date] ?? 1;
    if (get(date, 2).start && get(date, 2).end) return 3;
    if (get(date, 1).start && get(date, 1).end) n = Math.max(n, 2);
    return Math.min(3, Math.max(1, n));
  }
  function addSlot(date: string) {
    setSlotCounts((p) => ({ ...p, [date]: Math.min(3, effCount(date) + 1) }));
  }
  function removeLast(date: string) {
    const n = effCount(date);
    clear(date, n - 1);
    setSlotCounts((p) => ({ ...p, [date]: n - 1 }));
  }
  function onType(date: string, slot: number, val: string) {
    bump(date, slot); // re-mount the time inputs to reflect the preset times
    if (val === "none") return clear(date, slot);
    const p = PRESETS.find((x) => x.key === val)!;
    // Store the chosen type explicitly; it stays even if times are later edited.
    update(date, slot, { type: val as ShiftType, start: p.start, end: p.end });
  }

  const activeShifts = useMemo(
    () =>
      Object.entries(cells)
        .filter(([, v]) => v.start && v.end)
        .map(([k, v]) => ({ date: k.split(":")[0], ...v })),
    [cells],
  );

  // Total net work hours for the whole request (each shift × its headcount).
  const totalHours = useMemo(
    () =>
      activeShifts.reduce(
        (sum, s) => sum + (netHours(s.start, s.end, s.pause) ?? 0) * s.quantity,
        0,
      ),
    [activeShifts],
  );
  const fmtH = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function submit() {
    if (activeShifts.length === 0) return;
    startTransition(async () => {
      const res = await createOrderRequest({
        shifts: activeShifts.map((s) => ({
          date: s.date,
          requiredQualification: qual,
          startTime: s.start,
          endTime: s.end,
          quantity: s.quantity,
          bereich: s.bereich.trim() || undefined,
        })),
      });
      if (res.ok) {
        toast.success(o("created"));
        router.push("/client/orders");
        router.refresh();
      } else {
        toast.error(o("saveError"));
      }
    });
  }

  function TypeSelect({ date, slot }: { date: string; slot: number }) {
    const cell = get(date, slot);
    const past = date < todayStr;
    return (
      <select
        disabled={past}
        value={cell.type}
        onChange={(e) => onType(date, slot, e.target.value)}
        className={cn(field, "min-w-20")}
      >
        <option value="none">{t("presetNone")}</option>
        <option value="early">{t("preset_early")}</option>
        <option value="late">{t("preset_late")}</option>
        <option value="night">{t("preset_night")}</option>
      </select>
    );
  }

  function ShiftCells({ date, slot, sep }: { date: string; slot: number; sep?: boolean }) {
    const cell = get(date, slot);
    const past = date < todayStr;
    return (
      <>
        <td className={cn("p-1", sep && "border-s")}>
          {TypeSelect({ date, slot })}
        </td>
        <td className="p-1">
          <input
            key={`s-${date}-${slot}-${ver[`${date}:${slot}`] ?? 0}`}
            type="time"
            disabled={past}
            defaultValue={cell.start}
            onChange={(e) => update(date, slot, { start: e.target.value })}
            className={cn(field, "min-w-24")}
          />
        </td>
        <td className="p-1">
          <input
            key={`e-${date}-${slot}-${ver[`${date}:${slot}`] ?? 0}`}
            type="time"
            disabled={past}
            defaultValue={cell.end}
            onChange={(e) => update(date, slot, { end: e.target.value })}
            className={cn(field, "min-w-24")}
          />
        </td>
        <td className="p-1">
          <input type="number" min={0} max={480} step={5} disabled={past} value={cell.pause} onChange={(e) => update(date, slot, { pause: Math.max(0, Number(e.target.value) || 0) })} className={cn(field, "w-16")} />
        </td>
        <td className="whitespace-nowrap p-1 text-end font-medium tabular-nums">
          {(() => {
            const net = netHours(cell.start, cell.end, cell.pause);
            return net === null ? <span className="text-muted-foreground">—</span> : fmtH(net);
          })()}
        </td>
        <td className="p-1">
          <input type="number" min={1} max={50} disabled={past} value={cell.quantity} onChange={(e) => update(date, slot, { quantity: Math.max(1, Number(e.target.value) || 1) })} className={cn(field, "w-14")} />
        </td>
        <td className="p-1">
          <input
            id={`bereich-${date}-${slot}`}
            type="text"
            disabled={past}
            value={cell.bereich}
            onChange={(e) => update(date, slot, { bereich: e.target.value })}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const idx = days.findIndex((x) => x.date === date);
              const nx = days[idx + 1];
              if (nx) document.getElementById(`bereich-${nx.date}-0`)?.focus();
            }}
            className={cn(field, "min-w-40")}
          />
        </td>
      </>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("year")}
          <input type="number" min={thisYear} max={thisYear + 2} value={year} onChange={(e) => setYear(Number(e.target.value) || thisYear)} className={cn(field, "w-24")} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("month")}
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={cn(field, "w-40")}>
            {monthNames.map((name, i) => (
              <option key={i} value={i + 1}>{name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {o("qualification")}
          <select value={qual} onChange={(e) => setQual(e.target.value as Qual)} className={cn(field, "w-56")}>
            {qualifications.map((q) => (
              <option key={q} value={q}>{eq(q)}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Month table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th className="p-2 text-start">Datum</th>
              <th className="p-2 text-start" colSpan={7}>{t("shift1")}</th>
            </tr>
            <tr className="border-b text-[11px] text-muted-foreground">
              <th className="p-1" />
              <th className="p-1 text-start font-normal">{t("von")}/{t("bis")}</th>
              <th className="p-1 text-start font-normal">{t("von")}</th>
              <th className="p-1 text-start font-normal">{t("bis")}</th>
              <th className="p-1 text-start font-normal">{t("pause")}</th>
              <th className="p-1 text-end font-normal">{t("netHours")}</th>
              <th className="p-1 text-start font-normal">{t("count")}</th>
              <th className="p-1 text-start font-normal">{t("ward")}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const rowCls = cn(
                d.past && "opacity-50",
                (d.weekend || d.holiday) && "bg-rose-500/10",
              );
              const count = effCount(d.date);
              const extra = Array.from({ length: count - 1 }, (_, k) => k + 1);
              return (
                <Fragment key={d.date}>
                  <tr title={d.holiday ?? undefined} className={cn("border-b", rowCls)}>
                    <td className="whitespace-nowrap p-2 font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{d.label}</span>
                        {d.holiday ? <span className="text-rose-600">•</span> : null}
                        {!d.past && count === 1 ? (
                          <button
                            type="button"
                            onClick={() => addSlot(d.date)}
                            aria-label={t("shift2")}
                            title={t("shift2")}
                            className="ms-auto flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                    {ShiftCells({ date: d.date, slot: 0 })}
                  </tr>
                  {extra.map((slot) => (
                    <tr key={slot} className={cn("border-b", rowCls)}>
                      <td className="whitespace-nowrap p-1 ps-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          {slot === count - 1 ? (
                            <button
                              type="button"
                              onClick={() => removeLast(d.date)}
                              aria-label={c("delete")}
                              title={c("delete")}
                              className="flex size-5 items-center justify-center rounded-full text-destructive hover:bg-destructive/10"
                            >
                              <X className="size-3.5" />
                            </button>
                          ) : (
                            <span className="size-5" />
                          )}
                          <span>↳ {t(slot === 1 ? "shift2" : "shift3")}</span>
                          {!d.past && slot === count - 1 && count < 3 ? (
                            <button
                              type="button"
                              onClick={() => addSlot(d.date)}
                              aria-label={t("shift3")}
                              title={t("shift3")}
                              className="ms-auto flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                      {ShiftCells({ date: d.date, slot })}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              {t("totalShifts")}:{" "}
              <span className="font-semibold text-foreground">{activeShifts.length}</span>
            </span>
            <span>
              {t("totalHours")}:{" "}
              <span className="font-semibold text-foreground">{fmtH(totalHours)} Std</span>
            </span>
          </div>
          <span className="text-xs">{t("saveHint")}</span>
        </div>
        <div className="flex gap-2">
          <Button onClick={submit} disabled={pending || activeShifts.length === 0} className="gap-2">
            <Save className="size-4" />
            {pending ? c("loading") : t("save")}
          </Button>
          <Button variant="outline" onClick={() => router.push("/client/orders")}>
            {c("cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}
