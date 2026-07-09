"use client";

import { useMemo, useState, useTransition, Fragment } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { germanHolidays } from "@/lib/holidays";
import { saveAvailability } from "@/app/[locale]/worker/availability/actions";
import { Plus, Calendar, CheckCircle2, Download, MapPin, Save, X, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AssignmentActions } from "@/components/worker/assignment-actions";
import { ShiftCancelControls } from "@/components/worker/shift-cancel-controls";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { submitLeaveRequest } from "@/app/[locale]/worker/leave/actions";

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
  // Planned net hours (break deducted). Shown yellow as "accepted" once the
  // worker confirms, before the client signs.
  scheduledHours?: number | null;
  // Client-confirmed net hours (break already deducted) — null until the
  // facility signs the Leistungsnachweis.
  confirmedHours?: number | null;
  // Worker asked the office to be taken off this shift (pending admin decision).
  cancelRequested?: boolean;
  cancelNote?: string | null;
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

// Seed the editable grid from the server's availability blocks. Extracted so the
// same shape is used on mount AND when the props later change (see the re-sync
// in the component).
function buildCells(blocks: InitialBlock[]): Record<string, Block> {
  const map: Record<string, Block> = {};
  const byDate: Record<string, number> = {};
  for (const b of blocks) {
    const slot = byDate[b.date] ?? 0;
    byDate[b.date] = slot + 1;
    map[`${b.date}:${slot}`] = matchType(b);
  }
  return map;
}
function buildCounts(blocks: InitialBlock[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const b of blocks) m[b.date] = (m[b.date] ?? 0) + 1;
  return m;
}

export function AvailabilityBuilder({
  year,
  month,
  initialBlocks,
  assignments = [],
  workerId,
  leaveDays = [],
  requiredHours,
  carryoverHours = 0,
}: {
  year: number;
  month: number;
  initialBlocks: InitialBlock[];
  assignments?: Assignment[];
  // Set when an admin edits on the worker's behalf (phone-in changes); the
  // worker's own page omits it and the action resolves the worker from the session.
  workerId?: string;
  requiredHours?: number;
  carryoverHours?: number;
  leaveDays?: { id: string; date: string; status: "pending" | "approved" | "rejected"; hours: number }[];
}) {
  const t = useTranslations("availability");
  const oq = useTranslations("orderRequest");
  const c = useTranslations("common");
  const eas = useTranslations("enums.assignmentStatus");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [leavePending, startLeaveTransition] = useTransition();
  const [leaveDates, setLeaveDates] = useState<string[]>([]);
  const [isLeaveOpen, setIsLeaveOpen] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);
  const holidays = useMemo(() => germanHolidays(year), [year]);

  // Month total of client-confirmed hours — already net of the break.
  const hoursFmt = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );
  const totals = useMemo(() => {
    const confirmed = (assignments || []).filter((a) => a.confirmedHours != null);
    const leaves = (leaveDays || []).filter((l) => l.status === "approved" && l.hours != null);
    // Accepted by the worker but not yet client-signed → the yellow figure.
    const accepted = (assignments || []).filter(
      (a) => a.status === "confirmed" && a.confirmedHours == null && a.scheduledHours != null,
    );
    return {
      hours:
        confirmed.reduce((sum, a) => sum + (a.confirmedHours ?? 0), 0) +
        leaves.reduce((sum, l) => sum + (l.hours ?? 0), 0),
      shifts: confirmed.length,
      acceptedHours: accepted.reduce((sum, a) => sum + (a.scheduledHours ?? 0), 0),
      acceptedShifts: accepted.length,
    };
  }, [assignments, leaveDays]);

  const [cells, setCells] = useState<Record<string, Block>>(() => buildCells(initialBlocks));
  const [counts, setCounts] = useState<Record<string, number>>(() => buildCounts(initialBlocks));

  // Re-seed the grid whenever the server sends a different month or refreshed
  // availability — after an access-link login resolves the session, a
  // router.refresh(), or month navigation. The useState initializers above run
  // only on mount, so without this the saved hours wouldn't appear until a hard
  // reload remounted the component (assignments render straight from props, so
  // they were never affected). Deterministic signature → no spurious resets that
  // would drop in-progress edits.
  const serverSig = useMemo(
    () =>
      `${year}-${month}:` +
      initialBlocks
        .map((b) => `${b.date}|${b.startTime ?? ""}|${b.endTime ?? ""}`)
        .sort()
        .join(","),
    [year, month, initialBlocks],
  );
  const [syncedSig, setSyncedSig] = useState(serverSig);
  if (syncedSig !== serverSig) {
    setSyncedSig(serverSig);
    setCells(buildCells(initialBlocks));
    setCounts(buildCounts(initialBlocks));
  }

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

  function toggleLeaveDate(d: string) {
    setLeaveDates((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  }

  function submitLeave() {
    if (leaveDates.length === 0) return;
    startLeaveTransition(async () => {
      const res = await submitLeaveRequest(leaveDates);
      if (res.ok) {
        toast.success(t("leaveRequested") || "Urlaub angefragt");
        setIsLeaveOpen(false);
        setLeaveDates([]);
        router.refresh();
      } else {
        toast.error(res.error || "Fehler");
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

  // Availability controls laid out for the mobile cards (no <td> wrappers) —
  // same state & handlers as TypeCells, so edits on either layout stay in sync.
  function TypeControls(date: string, slot: number) {
    const b = get(date, slot);
    const timed = b.type !== "none" && b.type !== "full";
    const k = `${date}:${slot}`;
    return (
      <div className="space-y-2">
        <select
          value={b.type}
          onChange={(e) => onType(date, slot, e.target.value as BType)}
          className={cn(field)}
        >
          <option value="none">{oq("presetNone")}</option>
          <option value="full">{t("fullDay")}</option>
          <option value="early">{oq("preset_early")}</option>
          <option value="late">{oq("preset_late")}</option>
          <option value="night">{oq("preset_night")}</option>
          <option value="custom">{t("custom")}</option>
        </select>
        {timed ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">
              {oq("von")}
              <input
                key={`ms-${k}-${ver[k] ?? 0}`}
                type="time"
                defaultValue={b.start}
                onChange={(e) => set(date, slot, { start: e.target.value })}
                className={cn(field, "mt-1")}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              {oq("bis")}
              <input
                key={`me-${k}-${ver[k] ?? 0}`}
                type="time"
                defaultValue={b.end}
                onChange={(e) => set(date, slot, { end: e.target.value })}
                className={cn(field, "mt-1")}
              />
            </label>
          </div>
        ) : null}
      </div>
    );
  }

  // Assignment status badge + accept/decline/cancel controls — shared verbatim
  // between the wide table and the mobile card.
  function assignmentStatus(a: Assignment, past: boolean) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {a.confirmedHours != null ? (
          <div className="flex items-center gap-1.5">
            <Badge className="gap-1 border-transparent bg-emerald-600 text-white">
              <CheckCircle2 className="size-3" />
              {t("confirmedByClient")}
            </Badge>
            <a
              href={`/api/confirmations/${a.id}/pdf`}
              className="inline-flex h-6 items-center justify-center rounded-md border border-input bg-background px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              title="Download PDF"
            >
              <Download className="size-3.5" />
            </a>
          </div>
        ) : a.status === "confirmed" ? (
          <Badge className="gap-1 border-transparent bg-amber-500 text-white">
            <CheckCircle2 className="size-3" />
            {t("confirmedByWorker")}
          </Badge>
        ) : (
          <Badge variant={a.status === "declined" ? "outline" : "secondary"}>
            {eas(a.status)}
          </Badge>
        )}
        {a.status === "pending" && !past ? <AssignmentActions assignmentId={a.id} /> : null}
        {a.status === "declined" && !past ? (
          <AssignmentActions assignmentId={a.id} declined />
        ) : null}
        {a.status !== "pending" ? (
          <ShiftCancelControls
            assignmentId={a.id}
            admin={Boolean(workerId)}
            status={a.status}
            signed={a.confirmedHours != null}
            isPast={past}
            cancelRequested={a.cancelRequested}
            cancelNote={a.cancelNote}
          />
        ) : null}
      </div>
    );
  }

  function assignmentHours(a: Assignment) {
    if (a.confirmedHours != null)
      return (
        <span className="font-semibold text-emerald-600">
          {hoursFmt.format(a.confirmedHours)} {t("hoursUnit")}
        </span>
      );
    if (a.status === "confirmed" && a.scheduledHours != null)
      return (
        <span className="font-semibold text-amber-600">
          {hoursFmt.format(a.scheduledHours)} {t("hoursUnit")}
        </span>
      );
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">
          {new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <Dialog open={isLeaveOpen} onOpenChange={setIsLeaveOpen}>
          <DialogTrigger
            render={
              <Button variant="outline" className="gap-2">
                <Calendar className="size-4" />
                {t("requestLeave") || "Urlaub beantragen"}
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("requestLeave") || "Urlaub beantragen"}</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-sm text-muted-foreground mb-4">
                {t("selectLeaveDates") || "Bitte wählen Sie die Tage aus:"}
              </p>
              <div className="max-h-64 overflow-y-auto space-y-2 border rounded-md p-2">
                {days.filter(d => !d.past).map(d => (
                  <label key={d.date} className="flex items-center gap-2 text-sm p-1 hover:bg-muted/50 rounded cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={leaveDates.includes(d.date)}
                      onChange={() => toggleLeaveDate(d.date)}
                      className="rounded border-input"
                    />
                    <span>{d.date} ({d.label})</span>
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsLeaveOpen(false)} disabled={leavePending}>
                {c("cancel")}
              </Button>
              <Button onClick={submitLeave} disabled={leavePending || leaveDates.length === 0}>
                {leavePending ? c("loading") : (t("submitLeave") || "Antrag senden")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="hidden overflow-x-auto rounded-lg border sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th className="p-2 text-start">Datum</th>
              <th className="p-2 text-start">{t("shiftOrTask")}</th>
              <th className="p-2 text-start">{oq("ward")}</th>
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
              const dayLeaves = (leaveDays || []).filter((l) => l.date === d.date && l.status !== "rejected");
              let isFirstRow = true;

              return (
                <Fragment key={d.date}>
                  {dayLeaves.map(l => {
                    const isFirst = isFirstRow;
                    isFirstRow = false;
                    const isPending = l.status === "pending";
                    return (
                      <tr key={l.id} className={cn("border-b", isPending ? "bg-amber-500/10" : "bg-rose-500/10")}>
                        <td className="whitespace-nowrap p-2 font-medium">
                          {isFirst ? (
                            <div className="flex items-center gap-1.5">
                              <span>{d.label}</span>
                              {d.holiday ? <span className="text-rose-600">•</span> : null}
                            </div>
                          ) : null}
                        </td>
                        <td className="p-2" colSpan={5}>
                          <div className="flex items-center gap-2">
                            {isPending ? (
                              <Badge className="bg-amber-500 text-white hover:bg-amber-600 border-transparent">
                                {t("leavePending") || "Urlaubsantrag ausstehend"}
                              </Badge>
                            ) : (
                              <Badge className="bg-rose-600 text-white hover:bg-rose-700 border-transparent">
                                {t("leaveApproved") || "Urlaub (Bitte nicht stören)"}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-2 whitespace-nowrap text-end">
                          {l.status === "approved" ? (
                            <span className="font-semibold text-emerald-600">
                              {hoursFmt.format(l.hours)} {t("hoursUnit")}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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
                          {a.address ? (
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-xs text-muted-foreground">{a.address}</span>
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.address)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-primary transition-colors"
                                title="Open in Google Maps"
                              >
                                <MapPin className="size-3.5" />
                              </a>
                            </div>
                          ) : null}
                        </td>
                        <td className="p-2">
                          {a.notes ? <div className="text-sm font-medium">{a.notes}</div> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            {a.confirmedHours != null ? (
                              <div className="flex items-center gap-1.5">
                                <Badge className="gap-1 border-transparent bg-emerald-600 text-white">
                                  <CheckCircle2 className="size-3" />
                                  {t("confirmedByClient")}
                                </Badge>
                                <a
                                  href={`/api/confirmations/${a.id}/pdf`}
                                  className="inline-flex items-center justify-center rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground h-6 px-1.5 text-xs text-muted-foreground"
                                  title="Download PDF"
                                >
                                  <Download className="size-3.5" />
                                </a>
                              </div>
                            ) : a.status === "confirmed" ? (
                              // Worker accepted — hours count as "confirmed" (yellow)
                              // until the client signs the Leistungsnachweis (→ green).
                              <Badge className="gap-1 border-transparent bg-amber-500 text-white">
                                <CheckCircle2 className="size-3" />
                                {t("confirmedByWorker")}
                              </Badge>
                            ) : (
                              <Badge variant={a.status === "declined" ? "outline" : "secondary"}>
                                {eas(a.status)}
                              </Badge>
                            )}
                            {a.status === "pending" && !d.past ? (
                              <AssignmentActions assignmentId={a.id} />
                            ) : null}
                            {a.status === "declined" && !d.past ? (
                              // Mistaken decline → let the worker take the shift back.
                              <AssignmentActions assignmentId={a.id} declined />
                            ) : null}
                            {a.status !== "pending" ? (
                              <ShiftCancelControls
                                assignmentId={a.id}
                                admin={Boolean(workerId)}
                                status={a.status}
                                signed={a.confirmedHours != null}
                                isPast={d.past}
                                cancelRequested={a.cancelRequested}
                                cancelNote={a.cancelNote}
                              />
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
                          ) : a.status === "confirmed" && a.scheduledHours != null ? (
                            <span className="font-semibold text-amber-600">
                              {hoursFmt.format(a.scheduledHours)} {t("hoursUnit")}
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
                      <td className="p-1"></td>
                      {TypeCells(d.date, slot)}
                      <td className="p-1"></td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          {totals.shifts > 0 || totals.acceptedHours > 0 || requiredHours !== undefined ? (
            <tfoot>
              <tr className="border-t-2 bg-emerald-500/10">
                <td colSpan={6} className="p-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <Clock className="size-4 text-emerald-600" />
                    {t("monthTotal")}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("monthTotalHint", { count: totals.shifts })}
                  </p>
                </td>
                <td className="whitespace-nowrap p-3 text-end align-middle">
                  {(() => {
                    // Per the office's ledger: this month's soll, minus the
                    // carryover balance from last month (positive = credit that
                    // reduces the soll), minus everything worked — confirmed
                    // (green) AND still-unconfirmed accepted (amber) alike.
                    // Remaining is what's still owed, so it's POSITIVE while the
                    // worker is short and ≤ 0 once the soll is met.
                    const worked = totals.acceptedHours + totals.hours;
                    const remaining = (requiredHours ?? 0) - carryoverHours - worked;
                    const signed = (n: number) => `${n > 0 ? "+" : ""}${hoursFmt.format(n)}`;
                    return (
                      <div className="flex flex-col items-end gap-1">
                        {requiredHours !== undefined && (
                          <div className="flex justify-between w-52 text-sm">
                            <span className="text-muted-foreground">{t("requiredHoursLabel")}:</span>
                            <span className="font-medium text-foreground">{hoursFmt.format(requiredHours)} {t("hoursUnit")}</span>
                          </div>
                        )}
                        {carryoverHours !== 0 && (
                          <div className="flex justify-between w-52 text-sm">
                            <span className="text-muted-foreground">{t("carryoverLabel")}:</span>
                            <span className={cn("font-medium", carryoverHours > 0 ? "text-emerald-600" : "text-foreground")}>
                              {signed(carryoverHours)} {t("hoursUnit")}
                            </span>
                          </div>
                        )}
                        {totals.acceptedHours > 0 && (
                          <div className="flex justify-between w-52 text-sm">
                            <span className="text-muted-foreground">{t("acceptedTotal")}:</span>
                            <span className="font-bold text-amber-600">{hoursFmt.format(totals.acceptedHours)} {t("hoursUnit")}</span>
                          </div>
                        )}
                        <div className="flex justify-between w-52 text-sm">
                          <span className="text-muted-foreground">{t("confirmedTotal")}:</span>
                          <span className="font-bold text-emerald-600">{hoursFmt.format(totals.hours)} {t("hoursUnit")}</span>
                        </div>
                        <div className="flex justify-between w-52 text-sm border-t border-emerald-500/20 pt-1 mt-1">
                          <span className="text-muted-foreground">{t("workedTotal")}:</span>
                          <span className="font-semibold text-foreground">{hoursFmt.format(worked)} {t("hoursUnit")}</span>
                        </div>
                        {requiredHours !== undefined && (
                          <div className="flex justify-between w-52 text-sm border-t border-emerald-500/20 pt-1 mt-1">
                            <span className="text-muted-foreground">{t("remainingHoursLabel")}:</span>
                            <span className={cn("font-bold", remaining > 0 ? "text-destructive" : "text-emerald-600")}>
                              {hoursFmt.format(remaining)} {t("hoursUnit")}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {/* Mobile — app-like day cards. Same state & handlers as the table above,
          so editing availability or acting on a shift works identically. */}
      <div className="space-y-2.5 sm:hidden">
        {days.map((d) => {
          const count = effCount(d.date);
          const slots = Array.from({ length: count }, (_, k) => k);
          const dayAssignments = (assignments || []).filter((a) => a.date === d.date);
          const dayLeaves = (leaveDays || []).filter(
            (l) => l.date === d.date && l.status !== "rejected",
          );
          const hasSetAvailability = slots.some((s) => get(d.date, s).type !== "none");
          const showEditor = !d.past || hasSetAvailability;
          return (
            <div
              key={d.date}
              className={cn(
                "overflow-hidden rounded-lg border",
                d.past && "opacity-70",
                (d.weekend || d.holiday) && "border-rose-500/30",
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-between gap-2 border-b px-3 py-2",
                  d.weekend || d.holiday ? "bg-rose-500/10" : "bg-muted/40",
                )}
              >
                <span className="font-semibold">{d.label}</span>
                {d.holiday ? (
                  <span className="text-xs font-medium text-rose-600">{d.holiday}</span>
                ) : null}
              </div>
              <div className="space-y-3 p-3">
                {dayLeaves.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2">
                    {l.status === "pending" ? (
                      <Badge className="border-transparent bg-amber-500 text-white hover:bg-amber-600">
                        {t("leavePending") || "Urlaubsantrag ausstehend"}
                      </Badge>
                    ) : (
                      <Badge className="border-transparent bg-rose-600 text-white hover:bg-rose-700">
                        {t("leaveApproved") || "Urlaub (Bitte nicht stören)"}
                      </Badge>
                    )}
                    {l.status === "approved" ? (
                      <span className="text-sm font-semibold text-emerald-600">
                        {hoursFmt.format(l.hours)} {t("hoursUnit")}
                      </span>
                    ) : null}
                  </div>
                ))}

                {dayAssignments.map((a) => (
                  <div key={a.id} className="space-y-2 rounded-md border bg-primary/5 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-primary">{a.facilityName}</div>
                        {a.address ? (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.address)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                          >
                            {a.address}
                            <MapPin className="size-3.5 shrink-0" />
                          </a>
                        ) : null}
                        {a.notes ? (
                          <div className="mt-0.5 text-xs font-medium">{a.notes}</div>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-sm font-medium text-primary">
                        {a.startTime}–{a.endTime}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {assignmentStatus(a, d.past)}
                      {assignmentHours(a)}
                    </div>
                  </div>
                ))}

                {showEditor ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t("availableHeader")}
                      </span>
                      {!d.past ? (
                        <div className="flex items-center gap-1.5">
                          {count > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeLast(d.date)}
                              aria-label={c("delete")}
                              className="flex size-6 items-center justify-center rounded-full text-destructive hover:bg-destructive/10"
                            >
                              <X className="size-4" />
                            </button>
                          ) : null}
                          {count < 3 ? (
                            <button
                              type="button"
                              onClick={() => addSlot(d.date)}
                              aria-label="+"
                              className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"
                            >
                              <Plus className="size-4" />
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {slots.map((s) => (
                      <div key={s} className="rounded-md border p-2">
                        {TypeControls(d.date, s)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {/* Month totals card — mirrors the table footer. */}
        {totals.shifts > 0 || totals.acceptedHours > 0 || requiredHours !== undefined ? (
          <div className="rounded-lg border-2 border-emerald-500/40 bg-emerald-500/10 p-3">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <Clock className="size-4 text-emerald-600" />
              {t("monthTotal")}
            </div>
            {(() => {
              // Same ledger as the table footer: soll − carryover − worked.
              const worked = totals.acceptedHours + totals.hours;
              const remaining = (requiredHours ?? 0) - carryoverHours - worked;
              const signed = (n: number) => `${n > 0 ? "+" : ""}${hoursFmt.format(n)}`;
              return (
                <div className="flex flex-col gap-1 text-sm">
                  {requiredHours !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("requiredHoursLabel")}:</span>
                      <span className="font-medium text-foreground">
                        {hoursFmt.format(requiredHours)} {t("hoursUnit")}
                      </span>
                    </div>
                  )}
                  {carryoverHours !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("carryoverLabel")}:</span>
                      <span
                        className={cn(
                          "font-medium",
                          carryoverHours > 0 ? "text-emerald-600" : "text-foreground",
                        )}
                      >
                        {signed(carryoverHours)} {t("hoursUnit")}
                      </span>
                    </div>
                  )}
                  {totals.acceptedHours > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("acceptedTotal")}:</span>
                      <span className="font-bold text-amber-600">
                        {hoursFmt.format(totals.acceptedHours)} {t("hoursUnit")}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("confirmedTotal")}:</span>
                    <span className="font-bold text-emerald-600">
                      {hoursFmt.format(totals.hours)} {t("hoursUnit")}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-emerald-500/20 pt-1">
                    <span className="text-muted-foreground">{t("workedTotal")}:</span>
                    <span className="font-semibold text-foreground">
                      {hoursFmt.format(worked)} {t("hoursUnit")}
                    </span>
                  </div>
                  {requiredHours !== undefined && (
                    <div className="flex justify-between border-t border-emerald-500/20 pt-1 font-bold">
                      <span className="text-muted-foreground">{t("remainingHoursLabel")}:</span>
                      <span className={cn(remaining > 0 ? "text-destructive" : "text-emerald-600")}>
                        {hoursFmt.format(remaining)} {t("hoursUnit")}
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ) : null}
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
