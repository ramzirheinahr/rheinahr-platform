"use client";

import { useMemo, useState, useTransition, Fragment } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { germanHolidays } from "@/lib/holidays";
import { saveAvailability } from "@/app/[locale]/worker/availability/actions";
import { Save, Plus, X, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AssignmentActions } from "@/components/worker/assignment-actions";

type BType = "none" | "full" | "early" | "late" | "night" | "custom";
type Block = { type: BType; start: string; end: string };

export type Assignment = {
  id: string;
  status: string;
  date: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  facilityName: string;
  address: string | null;
  // Client-confirmed net hours (break already deducted) — null until the
  // facility signs the Leistungsnachweis.
  confirmedHours?: number | null;
};

export type InitialBlock = { date: string; startTime: string | null; endTime: string | null };

const PRESETS: Record<"early" | "late" | "night", { start: string; end: string }> = {
  early: { start: "06:30", end: "14:00" },
  late: { start: "13:30", end: "21:00" },
  night: { start: "20:30", end: "07:00" },
};
const pad = (n: number) => String(n).padStart(2, "0");
const EMPTY: Block = { type: "none", start: "", end: "" };
const matchType = (b: InitialBlock): Block => {
  if (b.startTime === null || b.endTime === null) return { type: "full", start: "", end: "" };
  const p = (Object.keys(PRESETS) as (keyof typeof PRESETS)[]).find(
    (k) => PRESETS[k].start === b.startTime && PRESETS[k].end === b.endTime,
  );
  return { type: p ?? "custom", start: b.startTime, end: b.endTime };
};

const field =
  "w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50";

export function AvailabilityBuilder({
  year,
  month,
  initialBlocks,
  assignments = [],
  workerId,
}: {
  year: number;
  month: number;
  initialBlocks: InitialBlock[];
  assignments?: Assignment[];
  // Set when an admin edits on the worker's behalf (phone-in changes); the
  // worker's own page omits it and the action resolves the worker from the session.
  workerId?: string;
}) {
  const t = useTranslations("availability");
  const oq = useTranslations("orderRequest");
  const c = useTranslations("common");
  const eas = useTranslations("enums.assignmentStatus");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const todayStr = new Date().toISOString().slice(0, 10);
  const holidays = useMemo(() => germanHolidays(year), [year]);

  // Month total of client-confirmed hours — already net of the break.
  const hoursFmt = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );
  const totals = useMemo(() => {
    const confirmed = (assignments || []).filter((a) => a.confirmedHours != null);
    return {
      hours: confirmed.reduce((sum, a) => sum + (a.confirmedHours ?? 0), 0),
      shifts: confirmed.length,
    };
  }, [assignments]);

  const [cells, setCells] = useState<Record<string, Block>>(() => {
    const map: Record<string, Block> = {};
    const byDate: Record<string, number> = {};
    for (const b of initialBlocks) {
      const slot = byDate[b.date] ?? 0;
      byDate[b.date] = slot + 1;
      map[`${b.date}:${slot}`] = matchType(b);
    }
    return map;
  });
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const b of initialBlocks) m[b.date] = (m[b.date] ?? 0) + 1;
    return m;
  });
  const [ver, setVer] = useState<Record<string, number>>({});
  const bump = (k: string) => setVer((p) => ({ ...p, [k]: (p[k] ?? 0) + 1 }));

  const get = (date: string, slot: number) => cells[`${date}:${slot}`] ?? EMPTY;
  const set = (date: string, slot: number, patch: Partial<Block>) =>
    setCells((p) => ({ ...p, [`${date}:${slot}`]: { ...EMPTY, ...p[`${date}:${slot}`], ...patch } }));
  const clear = (date: string, slot: number) =>
    setCells((p) => {
      const n = { ...p };
      delete n[`${date}:${slot}`];
      return n;
    });

  const effCount = (date: string) => {
    let n = counts[date] ?? 1;
    if (get(date, 2).type !== "none") return 3;
    if (get(date, 1).type !== "none") n = Math.max(n, 2);
    return Math.min(3, Math.max(1, n));
  };
  const addSlot = (date: string) => setCounts((p) => ({ ...p, [date]: Math.min(3, effCount(date) + 1) }));
  const removeLast = (date: string) => {
    const n = effCount(date);
    clear(date, n - 1);
    setCounts((p) => ({ ...p, [date]: n - 1 }));
  };

  function onType(date: string, slot: number, val: BType) {
    bump(`${date}:${slot}`);
    if (val === "none") return clear(date, slot);
    if (val === "full") return set(date, slot, { type: "full", start: "", end: "" });
    if (val === "custom") {
      const cur = get(date, slot);
      return set(date, slot, { type: "custom", start: cur.start || "06:30", end: cur.end || "14:00" });
    }
    set(date, slot, { type: val, start: PRESETS[val].start, end: PRESETS[val].end });
  }

  const days = useMemo(() => {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const date = `${year}-${pad(month)}-${pad(day)}`;
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      return {
        date,
        label: fmt.format(new Date(Date.UTC(year, month - 1, day))),
        weekend: dow === 0 || dow === 6,
        holiday: holidays.get(date),
        past: date < todayStr,
      };
    });
  }, [year, month, locale, holidays, todayStr]);

  function save() {
    const blocks = Object.entries(cells)
      .map(([k, b]) => ({ date: k.split(":")[0], b }))
      .filter(({ b }) => b.type === "full" || (b.type !== "none" && b.start && b.end))
      .map(({ date, b }) =>
        b.type === "full"
          ? { date, startTime: null, endTime: null }
          : { date, startTime: b.start, endTime: b.end },
      );
    startTransition(async () => {
      const res = await saveAvailability(year, month, blocks, workerId);
      if (res.ok) {
        toast.success(t("saved"));
        router.refresh();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  function TypeCells(date: string, slot: number) {
    const b = get(date, slot);
    const timed = b.type !== "none" && b.type !== "full";
    const k = `${date}:${slot}`;
    return (
      <>
        <td className="p-1">
          <select value={b.type} onChange={(e) => onType(date, slot, e.target.value as BType)} className={cn(field, "min-w-28")}>
            <option value="none">{oq("presetNone")}</option>
            <option value="full">{t("fullDay")}</option>
            <option value="early">{oq("preset_early")}</option>
            <option value="late">{oq("preset_late")}</option>
            <option value="night">{oq("preset_night")}</option>
            <option value="custom">{t("custom")}</option>
          </select>
        </td>
        <td className="p-1">
          <input
            key={`s-${k}-${ver[k] ?? 0}`}
            type="time"
            disabled={!timed}
            defaultValue={b.start}
            onChange={(e) => set(date, slot, { start: e.target.value })}
            className={cn(field, "min-w-24")}
          />
        </td>
        <td className="p-1">
          <input
            key={`e-${k}-${ver[k] ?? 0}`}
            type="time"
            disabled={!timed}
            defaultValue={b.end}
            onChange={(e) => set(date, slot, { end: e.target.value })}
            className={cn(field, "min-w-24")}
          />
        </td>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th className="p-2 text-start">Datum</th>
              <th className="p-2 text-start">{t("shiftOrTask")}</th>
              <th className="p-2 text-start">{t("availableHeader")}</th>
              <th className="p-2 text-start">{oq("von")}</th>
              <th className="p-2 text-start">{oq("bis")}</th>
              <th className="p-2 text-end">{t("hoursHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const rowCls = cn(d.past && "opacity-50", (d.weekend || d.holiday) && "bg-rose-500/10");
              const count = effCount(d.date);
              const extra = Array.from({ length: count - 1 }, (_, k) => k + 1);
              const dayAssignments = (assignments || []).filter((a) => a.date === d.date);
              let isFirstRow = true;

              return (
                <Fragment key={d.date}>
                  {dayAssignments.map((a) => {
                    const isFirst = isFirstRow;
                    isFirstRow = false;
                    return (
                      <tr key={a.id} className={cn("border-b bg-primary/5", d.past && "opacity-50")}>
                        <td className="whitespace-nowrap p-2 font-medium">
                          {isFirst ? (
                            <div className="flex items-center gap-1.5">
                              <span>{d.label}</span>
                              {d.holiday ? <span className="text-rose-600">•</span> : null}
                            </div>
                          ) : null}
                        </td>
                        <td className="p-2">
                          <div className="font-medium text-primary">{a.facilityName}</div>
                          {a.address ? <div className="text-xs text-muted-foreground">{a.address}</div> : null}
                          {a.notes ? <div className="text-xs text-muted-foreground">{oq("ward")}: {a.notes}</div> : null}
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            {a.confirmedHours != null ? (
                              <Badge className="gap-1 border-transparent bg-emerald-600 text-white">
                                <CheckCircle2 className="size-3" />
                                {t("confirmedByClient")}
                              </Badge>
                            ) : (
                              <Badge variant={a.status === "confirmed" ? "default" : a.status === "declined" ? "outline" : "secondary"}>
                                {eas(a.status)}
                              </Badge>
                            )}
                            {a.status === "pending" && !d.past ? (
                              <AssignmentActions assignmentId={a.id} />
                            ) : null}
                          </div>
                        </td>
                        <td className="p-2 whitespace-nowrap font-medium text-primary">
                          {a.startTime}
                        </td>
                        <td className="p-2 whitespace-nowrap font-medium text-primary">
                          {a.endTime}
                        </td>
                        <td className="p-2 whitespace-nowrap text-end">
                          {a.confirmedHours != null ? (
                            <span className="font-semibold text-emerald-600">
                              {hoursFmt.format(a.confirmedHours)} {t("hoursUnit")}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr title={d.holiday ?? undefined} className={cn("border-b", rowCls)}>
                    <td className="whitespace-nowrap p-2 font-medium">
                      <div className="flex items-center gap-1.5">
                        <span className={cn(!isFirstRow && "opacity-0")}>{d.label}</span>
                        {isFirstRow && d.holiday ? <span className="text-rose-600">•</span> : null}
                        {!d.past && count === 1 ? (
                          <button type="button" onClick={() => addSlot(d.date)} aria-label="+" className="ms-auto flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20">
                            <Plus className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-1"></td>
                    {TypeCells(d.date, 0)}
                    <td className="p-1"></td>
                  </tr>
                  {extra.map((slot) => (
                    <tr key={slot} className={cn("border-b", rowCls)}>
                      <td className="whitespace-nowrap p-1 ps-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          {slot === count - 1 ? (
                            <button type="button" onClick={() => removeLast(d.date)} aria-label={c("delete")} className="flex size-5 items-center justify-center rounded-full text-destructive hover:bg-destructive/10">
                              <X className="size-3.5" />
                            </button>
                          ) : <span className="size-5" />}
                          {!d.past && slot === count - 1 && count < 3 ? (
                            <button type="button" onClick={() => addSlot(d.date)} aria-label="+" className="ms-auto flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20">
                              <Plus className="size-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-1"></td>
                      {TypeCells(d.date, slot)}
                      <td className="p-1"></td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          {totals.shifts > 0 ? (
            <tfoot>
              <tr className="border-t-2 bg-emerald-500/10">
                <td colSpan={5} className="p-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <Clock className="size-4 text-emerald-600" />
                    {t("monthTotal")}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("monthTotalHint", { count: totals.shifts })}
                  </p>
                </td>
                <td className="whitespace-nowrap p-3 text-end align-middle text-lg font-bold text-emerald-600">
                  {hoursFmt.format(totals.hours)} {t("hoursUnit")}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-3 rounded border bg-rose-500/20" /> {t("weekendLegend")} / {t("holidayLegend")}</span>
          <span>{t("legend")}</span>
        </div>
        <Button onClick={save} disabled={pending} className="gap-2">
          <Save className="size-4" />
          {pending ? c("loading") : t("save")}
        </Button>
      </div>
    </div>
  );
}
