"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { qualifications } from "@/lib/validations";
import {
  rateFor,
  DEFAULT_SURCHARGES,
  DEFAULT_RATES,
  DEFAULT_NIGHT_WINDOW,
  VAT_RATE,
  shiftSurchargeHours,
  comboMultiplier,
  comboKey,
  type Surcharges,
  type Rates,
  type NightWindow,
  type SurchargeComponent,
} from "@/lib/pricing";
import { germanHolidays } from "@/lib/holidays";
import {
  createOrderRequest,
  updateOrderRequest,
} from "@/app/[locale]/client/orders/actions";
import {
  createOrderRequestForClient,
  updateOrderRequestAsAdmin,
} from "@/app/[locale]/admin/orders/actions";
import { ShiftMetaCell, type ShiftMeta } from "@/components/orders/shift-meta-cell";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useWarnUnsaved } from "@/hooks/use-warn-unsaved";
import { useUndoStack } from "@/hooks/use-undo-stack";

export type InitialRequest = {
  requestGroupId: string;
  qual: string;
  shifts: {
    date: string;
    start: string;
    end: string;
    pause: number;
    quantity: number;
    bereich: string;
  }[];
};
import { Send, Plus, X, Copy, ClipboardPaste, Info, Undo2, Redo2 } from "lucide-react";

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
const matchPreset = (start: string, end: string): ShiftType =>
  (PRESETS.find((p) => p.start === start && p.end === end)?.key as ShiftType) ?? "none";

// Build initial cell map + per-day slot counts from an existing request.
function fromInitial(shifts: InitialRequest["shifts"]) {
  const cells: Record<string, Cell> = {};
  const counts: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  for (const s of shifts) {
    const slot = byDate[s.date] ?? 0;
    byDate[s.date] = slot + 1;
    counts[s.date] = slot + 1;
    cells[`${s.date}:${slot}`] = {
      type: matchPreset(s.start, s.end),
      start: s.start,
      end: s.end,
      pause: s.pause,
      quantity: s.quantity,
      bereich: s.bereich,
    };
  }
  return { cells, counts };
}
const field =
  "w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50";

export function OrderRequestBuilder({
  initial,
  clients,
  surcharges,
  rates,
  nightWindow,
  readOnly = false,
  adminEdit = false,
  backHref,
  shiftMeta,
  assignable = false,
}: {
  initial?: InitialRequest;
  // When provided, the builder runs in admin mode: the admin must pick the
  // target client and the request is created on that client's account. Each
  // client carries its own billing surcharges and hourly rates.
  clients?: {
    id: string;
    name: string;
    surcharges: Surcharges;
    rates: Rates;
    night: NightWindow;
  }[];
  // Client mode: the logged-in client's resolved surcharges.
  surcharges?: Surcharges;
  // Client mode: the logged-in client's resolved per-qualification hourly rates.
  rates?: Rates;
  // Client mode: the logged-in client's night-surcharge window.
  nightWindow?: NightWindow;
  // Review mode: same table shape, all inputs locked, no submit.
  readOnly?: boolean;
  // Admin adjusting an existing request → route the save to the admin action.
  adminEdit?: boolean;
  // Where "Cancel" (and, in review mode, the whole flow) returns to.
  backHref?: string;
  // Per-shift pipeline data keyed `${date}:${slot}` — adds a status column to
  // the table (client review) and, with `assignable`, the admin's assignment
  // dialog per shift.
  shiftMeta?: Record<string, ShiftMeta>;
  assignable?: boolean;
}) {
  const t = useTranslations("orderRequest");
  const o = useTranslations("orders");
  const c = useTranslations("common");
  const eq = useTranslations("enums.qualification");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isAdmin = Boolean(clients);
  const ro = readOnly;
  // Admins may enter/edit shifts on past days (e.g. fixing a request after the
  // fact); clients are locked to today onward.
  const allowPast = isAdmin || adminEdit;
  const cancelHref = backHref ?? (isAdmin || adminEdit ? "/admin/orders" : "/client/orders");
  const [clientId, setClientId] = useState<string>("");

  const now = new Date();
  const thisYear = now.getUTCFullYear();
  const todayStr = now.toISOString().slice(0, 10);

  const firstDate = initial?.shifts[0]?.date;
  const initData = initial ? fromInitial(initial.shifts) : null;

  const [year, setYear] = useState(firstDate ? Number(firstDate.slice(0, 4)) : thisYear);
  const [month, setMonth] = useState(
    firstDate ? Number(firstDate.slice(5, 7)) : now.getUTCMonth() + 1,
  );
  const [qual, setQual] = useState<Qual>((initial?.qual as Qual) ?? qualifications[0]);

  const { state: undoState, set: setUndoState, undo: undoOriginal, redo: redoOriginal, canUndo, canRedo, clearHistory } = useUndoStack<{
    cells: Record<string, Cell>;
    counts: Record<string, number>;
  }>({
    cells: initData?.cells ?? {},
    counts: initData?.counts ?? {},
  });
  const cells = undoState.cells;
  const slotCounts = undoState.counts;
  
  const [historyVer, setHistoryVer] = useState(0);
  const undo = () => { undoOriginal(); setHistoryVer((v) => v + 1); };
  const redo = () => { redoOriginal(); setHistoryVer((v) => v + 1); };
  
  useWarnUnsaved(canUndo);

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
    setUndoState((prev) => ({
      ...prev,
      cells: {
        ...prev.cells,
        [key]: { ...EMPTY, ...prev.cells[key], ...patch },
      },
    }));
  }
  function clear(date: string, slot: number) {
    setUndoState((prev) => {
      const n = { ...prev.cells };
      delete n[`${date}:${slot}`];
      return { ...prev, cells: n };
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
    setUndoState((prev) => ({
      ...prev,
      counts: { ...prev.counts, [date]: Math.min(3, effCount(date) + 1) },
    }));
  }
  // Cancel/zero a single shift: remove that row and pull the later shifts of the
  // day up one slot (max 3), so there are never gaps. Zeroing the only shift of
  // a day just empties its first row. On save the diff drops the removed order
  // (and any assignments) — see diffRequestShifts.
  function removeShiftRow(date: string, slot: number) {
    const n = effCount(date);
    setUndoState((prev) => {
      const nextCells = { ...prev.cells };
      for (let s = slot; s < 2; s++) {
        const above = nextCells[`${date}:${s + 1}`];
        if (above) nextCells[`${date}:${s}`] = above;
        else delete nextCells[`${date}:${s}`];
      }
      delete nextCells[`${date}:2`];
      return {
        cells: nextCells,
        counts: { ...prev.counts, [date]: Math.max(1, n - 1) },
      };
    });
    for (let s = slot; s <= 2; s++) bump(date, s); // re-mount time inputs
  }
  // Row-level copy/paste: copy a filled day's shifts, paste them onto empty days
  // so clients can replicate a recurring shift pattern without retyping.
  const [clip, setClip] = useState<{ cells: Cell[]; count: number } | null>(null);
  const dayHasContent = (date: string) => {
    const c0 = get(date, 0);
    return Boolean(c0.start && c0.end);
  };
  function copyDay(date: string) {
    const n = effCount(date);
    setClip({
      cells: Array.from({ length: n }, (_, slot) => ({ ...get(date, slot) })),
      count: n,
    });
    toast.success(t("copiedToast"));
  }
  function pasteDay(date: string) {
    if (!clip) return;
    setUndoState((prev) => {
      const nextCells = { ...prev.cells };
      clip.cells.forEach((cell, slot) => {
        nextCells[`${date}:${slot}`] = { ...cell };
      });
      return {
        cells: nextCells,
        counts: { ...prev.counts, [date]: clip.count },
      };
    });
    clip.cells.forEach((_, slot) => bump(date, slot));
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
        .map(([k, v]) => ({ date: k.split(":")[0], ...v }))
        .filter((s) => {
          const sYear = Number(s.date.slice(0, 4));
          const sMonth = Number(s.date.slice(5, 7));
          return sYear === year && sMonth === month;
        }),
    [cells, year, month],
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

  // Active surcharges: in admin mode the selected client's; in client mode the
  // logged-in client's; otherwise the platform default.
  const selectedClient = clients?.find((cl) => cl.id === clientId);
  const sc: Surcharges = isAdmin
    ? selectedClient?.surcharges ?? DEFAULT_SURCHARGES
    : surcharges ?? DEFAULT_SURCHARGES;
  const rt: Rates = isAdmin
    ? selectedClient?.rates ?? DEFAULT_RATES
    : rates ?? DEFAULT_RATES;
  const nightWin: NightWindow = isAdmin
    ? selectedClient?.night ?? DEFAULT_NIGHT_WINDOW
    : nightWindow ?? DEFAULT_NIGHT_WINDOW;

  // Billing (netto): each shift is hours × headcount × base rate, uplifted by
  // the day's Zuschlag (Sat/Sun/holiday). Holidays are resolved per shift year.
  // Grouped by day category so we can show a transparent calculation breakdown.
  const rate = useMemo(() => rateFor(qual, rt), [qual, rt]);
  const billing = useMemo(() => {
    const holidayCache = new Map<number, Map<string, string>>();
    const isHoliday = (dateStr: string) => {
      const y = Number(dateStr.slice(0, 4));
      let h = holidayCache.get(y);
      if (!h) {
        h = germanHolidays(y);
        holidayCache.set(y, h);
      }
      return h.has(dateStr);
    };
    // Split every shift's net hours by the SET of surcharges per hour, so
    // overnight shifts are billed per calendar day (Sat→Sun at midnight) and
    // coinciding surcharges (e.g. Sunday + holiday, Sunday + night) are summed.
    const groups = new Map<string, { components: SurchargeComponent[]; hours: number }>();
    for (const s of activeShifts) {
      const g = shiftSurchargeHours(s.date, s.start, s.end, s.pause, isHoliday, nightWin);
      for (const [key, val] of g) {
        const cur = groups.get(key);
        if (cur) cur.hours += val.hours * s.quantity;
        else groups.set(key, { components: val.components, hours: val.hours * s.quantity });
      }
    }
    const rows = [...groups.values()]
      .map((g) => {
        const mult = comboMultiplier(g.components, sc);
        return {
          key: comboKey(g.components),
          components: g.components,
          hours: g.hours,
          mult,
          amount: g.hours * rate * mult,
        };
      })
      .sort((a, b) => a.mult - b.mult);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    return { rows, total };
  }, [activeShifts, rate, sc, nightWin]);
  const totalPrice = billing.total;
  const fmtEur = (n: number) =>
    n.toLocaleString(locale, { style: "currency", currency: "EUR" });
  const pct = (n: number) =>
    `${(n * 100).toLocaleString(locale, { maximumFractionDigits: 0 })} %`;
  const [showCalc, setShowCalc] = useState(false);

  function submit() {
    if (activeShifts.length === 0) return;
    if (isAdmin && !clientId) {
      toast.error(t("selectClientError"));
      return;
    }
    const payload = {
      shifts: activeShifts.map((s) => ({
        date: s.date,
        requiredQualification: qual,
        startTime: s.start,
        endTime: s.end,
        pause: s.pause,
        quantity: s.quantity,
        bereich: s.bereich.trim() || undefined,
      })),
    };
    startTransition(async () => {
      const res =
        adminEdit && initial
          ? await updateOrderRequestAsAdmin(initial.requestGroupId, payload)
          : isAdmin
            ? await createOrderRequestForClient(clientId, payload)
            : initial
              ? await updateOrderRequest(initial.requestGroupId, payload)
              : await createOrderRequest(payload);
      if (res.ok) {
        toast.success(o(initial ? "updated" : "created"));
        clearHistory();
        router.push(adminEdit ? `/admin/orders/${initial!.requestGroupId}` : cancelHref);
        router.refresh();
      } else {
        toast.error(o("saveError"));
      }
    });
  }

  function TypeSelect({ date, slot }: { date: string; slot: number }) {
    const cell = get(date, slot);
    const past = (date < todayStr && !allowPast) || ro;
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
    const past = (date < todayStr && !allowPast) || ro;
    return (
      <>
        <td className={cn("p-1", sep && "border-s")}>
          {TypeSelect({ date, slot })}
        </td>
        <td className="p-1">
          <input
            key={`s-${date}-${slot}-${ver[`${date}:${slot}`] ?? 0}-${historyVer}`}
            type="time"
            disabled={past}
            defaultValue={cell.start}
            onChange={(e) => update(date, slot, { start: e.target.value })}
            className={cn(field, "min-w-20")}
          />
        </td>
        <td className="p-1">
          <input
            key={`e-${date}-${slot}-${ver[`${date}:${slot}`] ?? 0}-${historyVer}`}
            type="time"
            disabled={past}
            defaultValue={cell.end}
            onChange={(e) => update(date, slot, { end: e.target.value })}
            className={cn(field, "min-w-20")}
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
            className={cn(field, "min-w-20")}
          />
        </td>
        {shiftMeta ? (
          <td className="whitespace-nowrap p-1">
            {shiftMeta[`${date}:${slot}`] ? (
              <ShiftMetaCell meta={shiftMeta[`${date}:${slot}`]} assignable={assignable} />
            ) : null}
          </td>
        ) : null}
      </>
    );
  }

  const renderActionButtons = () => {
    if (ro) return null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border p-0.5 mr-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            disabled={!canUndo || pending}
            onClick={undo}
            aria-label={t("undo") || "Rückgängig"}
            title={t("undo") || "Rückgängig"}
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            disabled={!canRedo || pending}
            onClick={redo}
            aria-label={t("redo") || "Wiederholen"}
            title={t("redo") || "Wiederholen"}
          >
            <Redo2 className="size-4" />
          </Button>
        </div>
        <Button onClick={submit} disabled={pending || activeShifts.length === 0 || (isAdmin && !clientId) || (!canUndo && !initial)} className="gap-2">
          <Send className="size-4" />
          {pending ? c("loading") : t("submit")}
        </Button>
        <Button variant="outline" onClick={() => router.push(cancelHref)}>
          {c("cancel")}
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Actions */}
      {!ro && (
        <div className="flex justify-end">
          {renderActionButtons()}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        {isAdmin ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>
              {t("client")} <span className="text-destructive">*</span>
            </span>
            <SearchableSelect
              className="w-64"
              value={clientId}
              onChange={setClientId}
              options={clients!.map((cl) => ({ value: cl.id, label: cl.name }))}
              placeholder={t("selectClient")}
              searchPlaceholder={t("searchClient")}
              emptyText={t("noClientMatch")}
              ariaLabel={t("client")}
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("year")}
          <input type="number" min={allowPast ? thisYear - 1 : thisYear} max={thisYear + 2} value={year} onChange={(e) => setYear(Number(e.target.value) || thisYear)} className={cn(field, "w-24")} />
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
          <select disabled={ro} value={qual} onChange={(e) => setQual(e.target.value as Qual)} className={cn(field, "w-56")}>
            {qualifications.map((q) => (
              <option key={q} value={q}>{eq(q)}</option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground">
            {fmtEur(rate)} / {t("perHour")}
          </span>
        </label>
      </div>

      {/* Month table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th className="p-2 text-start">Datum</th>
              <th className="p-2 text-start" colSpan={shiftMeta ? 8 : 7}>{t("shift1")}</th>
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
              {shiftMeta ? (
                <th className="p-1 text-start font-normal">{o("status")}</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const lockedDay = d.past && !allowPast;
              const rowCls = cn(
                lockedDay && "opacity-50",
                (d.weekend || d.holiday) && "bg-rose-500/10",
              );
              const count = effCount(d.date);
              const extra = Array.from({ length: count - 1 }, (_, k) => k + 1);
              return (
                <Fragment key={d.date}>
                  <tr title={d.holiday ?? undefined} className={cn("border-b", rowCls)}>
                    <td className="whitespace-nowrap p-2 font-medium">
                      <div className="flex items-center gap-1.5">
                        <span className="flex size-5 shrink-0 items-center justify-center">
                          {lockedDay || ro ? null : dayHasContent(d.date) ? (
                            <button
                              type="button"
                              onClick={() => copyDay(d.date)}
                              aria-label={t("copyTitle")}
                              title={t("copyTitle")}
                              className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <Copy className="size-3.5" />
                            </button>
                          ) : clip ? (
                            <button
                              type="button"
                              onClick={() => pasteDay(d.date)}
                              aria-label={t("pasteTitle")}
                              title={t("pasteTitle")}
                              className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"
                            >
                              <ClipboardPaste className="size-3.5" />
                            </button>
                          ) : null}
                        </span>
                        <span>{d.label}</span>
                        {d.holiday ? <span className="text-rose-600">•</span> : null}
                        {!lockedDay && !ro ? (
                          <span className="ms-auto flex items-center gap-1">
                            {dayHasContent(d.date) ? (
                              <button
                                type="button"
                                onClick={() => removeShiftRow(d.date, 0)}
                                aria-label={t("cancelShift")}
                                title={t("cancelShift")}
                                className="flex size-5 items-center justify-center rounded-full text-destructive hover:bg-destructive/10"
                              >
                                <X className="size-3.5" />
                              </button>
                            ) : null}
                            {count === 1 ? (
                              <button
                                type="button"
                                onClick={() => addSlot(d.date)}
                                aria-label={t("shift2")}
                                title={t("shift2")}
                                className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"
                              >
                                <Plus className="size-3.5" />
                              </button>
                            ) : null}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    {ShiftCells({ date: d.date, slot: 0 })}
                  </tr>
                  {extra.map((slot) => (
                    <tr key={slot} className={cn("border-b", rowCls)}>
                      <td className="whitespace-nowrap p-1 ps-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          {!ro && !lockedDay ? (
                            <button
                              type="button"
                              onClick={() => removeShiftRow(d.date, slot)}
                              aria-label={t("cancelShift")}
                              title={t("cancelShift")}
                              className="flex size-5 items-center justify-center rounded-full text-destructive hover:bg-destructive/10"
                            >
                              <X className="size-3.5" />
                            </button>
                          ) : (
                            <span className="size-5" />
                          )}
                          <span>↳ {t(slot === 1 ? "shift2" : "shift3")}</span>
                          {!lockedDay && !ro && slot === count - 1 && count < 3 ? (
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
            <span className="inline-flex items-center gap-1">
              {t("totalPrice")}:{" "}
              <span className="font-semibold text-foreground">{fmtEur(totalPrice)}</span>
              <span className="relative inline-flex">
                <button
                  type="button"
                  onClick={() => setShowCalc((v) => !v)}
                  aria-label={t("showCalc")}
                  title={t("showCalc")}
                  className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Info className="size-3.5" />
                </button>
                {showCalc ? (
                  <>
                    <button
                      type="button"
                      aria-hidden
                      tabIndex={-1}
                      onClick={() => setShowCalc(false)}
                      className="fixed inset-0 z-40 cursor-default"
                    />
                    <div className="absolute bottom-full end-0 z-50 mb-2 w-72 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
                      <div className="mb-2 text-xs font-semibold text-foreground">
                        {t("calcTitle")}
                      </div>
                      {activeShifts.length === 0 ? (
                        <div className="text-xs text-muted-foreground">
                          {t("calcEmpty")}
                        </div>
                      ) : (
                        <div className="space-y-1 text-xs">
                          {billing.rows
                            .filter((r) => r.hours > 0)
                            .map((r) => (
                              <div key={r.key} className="flex justify-between gap-2">
                                <span className="text-muted-foreground">
                                  {r.components.length
                                    ? r.components.map((cc) => t(`cat_${cc}`)).join(" + ")
                                    : t("cat_base")}
                                  : {fmtH(r.hours)} × {fmtEur(rate)}
                                  {r.mult !== 1 ? ` × ${r.mult.toLocaleString(locale, { maximumFractionDigits: 2 })}` : ""}
                                </span>
                                <span className="whitespace-nowrap font-medium text-foreground">
                                  {fmtEur(r.amount)}
                                </span>
                              </div>
                            ))}
                          <div className="mt-2 flex justify-between gap-2 border-t pt-2 font-semibold text-foreground">
                            <span>{t("netTotal")}</span>
                            <span>{fmtEur(totalPrice)}</span>
                          </div>
                          <div className="flex justify-between gap-2 text-muted-foreground">
                            <span>{t("vat")}</span>
                            <span>{fmtEur(totalPrice * VAT_RATE)}</span>
                          </div>
                          <div className="flex justify-between gap-2 font-semibold text-foreground">
                            <span>{t("grossTotal")}</span>
                            <span>{fmtEur(totalPrice * (1 + VAT_RATE))}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </span>
            </span>
          </div>
          <span className="block text-xs">
            {ro ? t("priceNote") : `${t("saveHint")} · ${t("priceNote")}`}
          </span>
          <span className="block text-xs">
            {t("surchargeNote", {
              sat: pct(sc.sat),
              sun: pct(sc.sun),
              hol: pct(sc.holiday),
            })}
          </span>
          <span className="block text-xs">
            {t("nightNote", {
              night: pct(sc.night),
              from: nightWin.start,
              to: nightWin.end,
            })}
          </span>
          <span className="block text-xs">{t("stackNote")}</span>
        </div>
        {ro ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden sm:block sm:flex-1" />
            {renderActionButtons()}
          </div>
        )}
      </div>
    </div>
  );
}
