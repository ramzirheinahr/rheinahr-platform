"use client";

import { useEffect, useMemo, useState, useTransition, Fragment } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { germanHolidays } from "@/lib/holidays";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BookText, CheckCircle2, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  layoutUnassigned,
  SHIFT_PRESETS,
  type GridFacility,
  type GridWorkerRow,
  type ShiftKey,
  type UnassignedShift,
} from "@/lib/master-schedule-core";
import type { Candidate } from "@/lib/orders";
import type { Qualification } from "@prisma/client";
import {
  assignFromGrid,
  assignWorkerToOrder,
  candidatesForOrder,
  createOpenOrderFromGrid,
  saveDayAvailabilityFromGrid,
  unassignFromGrid,
  approveShiftCancellation,
  rejectShiftCancellation,
} from "@/app/[locale]/admin/schedule/actions";

// The company's Excel Dienstplan, digital: two lines per worker per day —
// availability letters on top (green ward number once the client signed),
// worked shift+facility codes below. Every cell edit writes to the real
// availability/order/assignment records; the grid is a live view, not a copy.

const pad = (n: number) => String(n).padStart(2, "0");

const SHIFT_LETTER: Record<ShiftKey, string> = { early: "F", late: "S", night: "N" };

const field =
  "w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

export function MasterScheduleGrid({
  year,
  month,
  qualification,
  rows,
  facilities,
  unassigned,
}: {
  year: number;
  month: number;
  qualification: Qualification;
  rows: GridWorkerRow[];
  facilities: GridFacility[];
  unassigned: UnassignedShift[];
}) {
  const t = useTranslations("masterSchedule");
  const oqShift = useTranslations("orderRequest");
  const av = useTranslations("availability");
  const locale = useLocale();

  const hoursFmt = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const holidays = useMemo(() => germanHolidays(year), [year]);

  const days = useMemo(() => {
    const wdFmt = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = `${year}-${pad(month)}-${pad(i + 1)}`;
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      return {
        day: i + 1,
        date,
        weekday: wdFmt.format(new Date(Date.UTC(year, month - 1, i + 1))),
        weekend: dow === 0 || dow === 6,
        holiday: holidays.get(date),
      };
    });
  }, [year, month, daysInMonth, holidays, locale]);

  const unassignedRows = useMemo(
    () => layoutUnassigned(unassigned, daysInMonth),
    [unassigned, daysInMonth],
  );

  // Column tints: holidays light green, weekends rose. `body`/`grey` for the
  // two table regions, `head` for the dark header row.
  type Day = (typeof days)[number];
  const bodyTint = (d: Day) =>
    d.holiday ? "bg-emerald-400/20" : d.weekend ? "bg-rose-500/15" : "";
  const greyTint = (d: Day) =>
    d.holiday ? "bg-emerald-400/25" : d.weekend ? "bg-muted-foreground/15" : "";
  const headTint = (d: Day) =>
    d.holiday ? "bg-emerald-700" : d.weekend ? "bg-rose-800" : "";

  const [legendOpen, setLegendOpen] = useState(false);

  const [target, setTarget] = useState<{ workerId: string; day: number } | null>(null);
  const targetRow = target ? rows.find((r) => r.workerId === target.workerId) : undefined;
  // Grey-section assign dialog: the open shift the admin clicked.
  const [openShift, setOpenShift] = useState<UnassignedShift | null>(null);
  // Grey-section "create order": the empty cell (day) the admin clicked.
  const [newOrderDay, setNewOrderDay] = useState<number | null>(null);
  // Extra blank rows in the grey section so several new orders can be entered.
  const [extraRows, setExtraRows] = useState(1);

  if (rows.length === 0) {
    return <p className="rounded-lg border p-6 text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <>
      <div dir="ltr" className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="border-collapse text-[11px] leading-tight">
          <thead>
            {/* Sticky first row: stays visible while the sheet scrolls. */}
            <tr>
              <th className="sticky start-0 top-0 z-30 min-w-40 border border-rose-950 bg-rose-950 p-1.5 text-start text-xs font-semibold text-white">
                {t("nameHeader")}
              </th>
              {days.map((d) => (
                <th
                  key={d.day}
                  title={d.holiday ?? undefined}
                  className={cn(
                    "sticky top-0 z-20 min-w-8 border border-rose-950/40 bg-rose-950 p-1 text-center text-[11px] font-semibold text-white",
                    headTint(d),
                  )}
                >
                  <div>{pad(d.day)}.</div>
                  <div className="text-[9px] font-normal uppercase opacity-80">{d.weekday}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.workerId}>
                {/* Line 1 — availability / green ward number once confirmed */}
                <tr>
                  <th
                    rowSpan={2}
                    className="sticky start-0 z-10 border border-rose-900/50 bg-rose-900 p-1.5 text-start align-middle text-xs font-medium text-white"
                  >
                    <div className="font-semibold">{r.name}</div>
                    <div className="mt-1 flex flex-col gap-0.5 text-[9px] font-normal opacity-90">
                      <div className="flex justify-between gap-1">
                        <span>{t("requiredHoursLabel")}:</span>
                        <span>{hoursFmt.format(r.requiredHours)}</span>
                      </div>
                      {r.carryoverHours !== 0 && (
                        <div className="flex justify-between gap-1">
                          <span>{av("carryoverLabel")}:</span>
                          <span>{r.carryoverHours > 0 ? "+" : ""}{hoursFmt.format(r.carryoverHours)}</span>
                        </div>
                      )}
                      <div className="flex justify-between gap-1">
                        <span>{av("confirmedTotal")}:</span>
                        <span>{hoursFmt.format(r.confirmedHours)}</span>
                      </div>
                      {(() => {
                        const remaining = r.requiredHours + r.carryoverHours - r.confirmedHours;
                        return (
                          <div className="flex justify-between gap-1 border-t border-white/20 pt-0.5">
                            <span>{remaining < 0 ? av("creditLabel") : t("remainingHoursLabel")}:</span>
                            <span>{hoursFmt.format(remaining)}</span>
                          </div>
                        );
                      })()}
                    </div>
                  </th>
                  {r.days.map((cell, i) => {
                    const d = days[i];
                    const confirmedJob = cell.jobs.find((j) => j.clientConfirmed);
                    const isPendingLeave = cell.leave?.status === "pending";
                    const isApprovedLeave = cell.leave?.status === "approved";
                    let title = "";
                    if (isPendingLeave) title = t("leavePending") || "Urlaubsantrag ausstehend";
                    if (isApprovedLeave) title = t("leaveApproved") || "Urlaub (Bitte nicht stören)";

                    return (
                      <td
                        key={i}
                        role="button"
                        tabIndex={0}
                        title={title || undefined}
                        onClick={() => setTarget({ workerId: r.workerId, day: d.day })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setTarget({ workerId: r.workerId, day: d.day });
                        }}
                        className={cn(
                          "h-6 cursor-pointer border p-0.5 text-center align-middle font-medium hover:ring-2 hover:ring-ring/60 hover:ring-inset",
                          bodyTint(d),
                          confirmedJob && !isApprovedLeave && "bg-emerald-600 font-bold text-white",
                          isPendingLeave && "bg-amber-500 font-bold text-white",
                          isApprovedLeave && "bg-rose-600 font-bold text-white",
                        )}
                      >
                        {isApprovedLeave ? "U" : isPendingLeave ? "U?" : confirmedJob ? confirmedJob.ward || "0" : cell.avail}
                      </td>
                    );
                  })}
                </tr>
                {/* Line 2 — worked: shift letter + facility code */}
                <tr className="border-b-2 border-b-border">
                  {r.days.map((cell, i) => {
                    const d = days[i];
                    return (
                      <td
                        key={i}
                        role="button"
                        tabIndex={0}
                        onClick={() => setTarget({ workerId: r.workerId, day: d.day })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setTarget({ workerId: r.workerId, day: d.day });
                        }}
                        className={cn(
                          "h-6 cursor-pointer whitespace-nowrap border p-0.5 text-center align-middle font-semibold text-red-600 hover:ring-2 hover:ring-ring/60 hover:ring-inset",
                          bodyTint(d),
                        )}
                      >
                        {cell.leave?.status === "approved" ? (
                          <span title={t("leaveApproved") || "Urlaub"} className="text-rose-600">
                            {hoursFmt.format(cell.leave.hours)}h
                          </span>
                        ) : (
                          cell.jobs.map((j) => (
                            <span
                              key={j.assignmentId}
                              title={
                                j.cancelRequested
                                  ? `${av("cancelRequestedBadge")} · ${j.facilityName} · ${j.startTime}–${j.endTime}`
                                  : `${j.facilityName} · ${j.startTime}–${j.endTime}`
                              }
                              className={cn(
                                "px-0.5",
                                j.status === "pending" && "opacity-50",
                                // Amber ring flags a pending worker cancellation request.
                                j.cancelRequested &&
                                  "rounded bg-amber-400/30 text-amber-700 ring-1 ring-amber-500",
                              )}
                            >
                              {j.letter}
                              {j.code}
                            </span>
                          ))
                        )}
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            ))}
          </tbody>
          {/* Grey section — requested shifts still without a worker. A shift
              cell opens the assign dialog; an EMPTY cell opens "create order",
              so the admin can fill a client's request straight on the sheet.
              Extra blank rows (+ button) allow several new orders at once. */}
          <tbody className="bg-muted">
            <tr>
              <th className="sticky start-0 z-10 border border-border bg-muted p-1.5 text-start text-[11px] font-semibold text-muted-foreground">
                <div className="flex items-center justify-between gap-1.5">
                  <span>{t("openShifts")}</span>
                  <button
                    type="button"
                    onClick={() => setExtraRows((n) => n + 1)}
                    aria-label={t("addRow")}
                    title={t("addRow")}
                    className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
              </th>
              {days.map((d) => (
                <td
                  key={d.day}
                  className={cn("border border-border bg-muted", greyTint(d))}
                />
              ))}
            </tr>
            {[
              ...unassignedRows,
              ...Array.from({ length: extraRows }, () => [] as (UnassignedShift | null)[]),
            ].map((row, ri) => (
              <tr key={ri}>
                <th className="sticky start-0 z-10 border border-border bg-muted p-1 ps-3 text-start text-[10px] font-normal text-muted-foreground">
                  {ri === 0 ? t("openShiftsRow") : ""}
                </th>
                {days.map((d, i) => {
                  const cellShift = row[i] ?? null;
                  return (
                    <td
                      key={i}
                      role="button"
                      tabIndex={0}
                      onClick={
                        cellShift
                          ? () => setOpenShift(cellShift)
                          : () => setNewOrderDay(d.day)
                      }
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        if (cellShift) setOpenShift(cellShift);
                        else setNewOrderDay(d.day);
                      }}
                      title={
                        cellShift
                          ? `${cellShift.facilityName} · ${cellShift.startTime}–${cellShift.endTime}`
                          : t("newOrderAria")
                      }
                      className={cn(
                        "group h-6 cursor-pointer whitespace-nowrap border border-border bg-muted p-0.5 text-center align-middle font-semibold text-foreground/80 hover:ring-2 hover:ring-ring/60 hover:ring-inset",
                        greyTint(d),
                      )}
                    >
                      {cellShift ? (
                        <>
                          {cellShift.letter}
                          {cellShift.code}
                          {cellShift.remaining > 1 ? (
                            <sup className="ms-0.5 text-[8px]">×{cellShift.remaining}</sup>
                          ) : null}
                        </>
                      ) : (
                        <Plus className="mx-auto size-3 text-muted-foreground/0 group-hover:text-muted-foreground/70" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          {target && targetRow ? (
            <CellEditor
              key={`${target.workerId}:${target.day}:${year}-${month}`}
              row={targetRow}
              date={`${year}-${pad(month)}-${pad(target.day)}`}
              cell={targetRow.days[target.day - 1]}
              facilities={facilities}
              locale={locale}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={openShift !== null} onOpenChange={(open) => !open && setOpenShift(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          {openShift ? (
            <OpenShiftEditor
              key={openShift.orderId}
              shift={openShift}
              onDone={() => setOpenShift(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={newOrderDay !== null} onOpenChange={(open) => !open && setNewOrderDay(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          {newOrderDay !== null ? (
            <NewOrderEditor
              key={newOrderDay}
              date={`${year}-${pad(month)}-${pad(newOrderDay)}`}
              qualification={qualification}
              facilities={facilities}
              locale={locale}
              onDone={() => setNewOrderDay(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Floating legend: the facility Kürzel index is off-screen to give the
          grid full width; this button opens it on demand. */}
      <Button
        onClick={() => setLegendOpen(true)}
        className="fixed bottom-6 end-6 z-40 gap-2 shadow-lg"
      >
        <BookText className="size-4" />
        {t("legend")}
      </Button>
      <Dialog open={legendOpen} onOpenChange={setLegendOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("legend")}</DialogTitle>
            <DialogDescription>
              F = {oqShift("preset_early")} · S = {oqShift("preset_late")} · N ={" "}
              {oqShift("preset_night")}
            </DialogDescription>
          </DialogHeader>
          <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {facilities.map((f) => (
              <li key={f.clientId} className="flex items-baseline gap-2">
                <span className="w-9 shrink-0 font-mono font-bold">{f.code}</span>
                <span className={cn("truncate", !f.hasCode && "text-muted-foreground")}>
                  {f.name}
                </span>
              </li>
            ))}
          </ul>
          {facilities.some((f) => !f.hasCode) ? (
            <p className="text-xs text-muted-foreground">{t("missingCodesHint")}</p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

// Grey-section dialog: choose a worker for one open requested shift. Loads the
// qualified candidates (available / busy / unavailable) on open; picking one
// assigns them. Busy/unavailable picks need an explicit confirm (force).
function OpenShiftEditor({
  shift,
  onDone,
}: {
  shift: UnassignedShift;
  onDone: () => void;
}) {
  const t = useTranslations("masterSchedule");
  const oq = useTranslations("orderRequest");
  const c = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // A worker the admin picked whose conflict needs confirming before assigning.
  const [confirmWorker, setConfirmWorker] = useState<string | null>(null);

  // Load candidates once when the dialog mounts.
  useEffect(() => {
    let active = true;
    candidatesForOrder(shift.orderId).then((res) => {
      if (!active) return;
      if (res.ok) setCandidates(res.candidates);
      else setLoadError(true);
    });
    return () => {
      active = false;
    };
  }, [shift.orderId]);

  function assign(workerId: string, force: boolean) {
    startTransition(async () => {
      const res = await assignWorkerToOrder(shift.orderId, workerId, force);
      if (res.ok) {
        toast.success(t("assigned"));
        router.refresh();
        onDone();
      } else if (res.error === "busy" || res.error === "unavailable") {
        setConfirmWorker(workerId);
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  const statusBadge: Record<Candidate["status"], { label: string; cls: string }> = {
    available: { label: t("candAvailable"), cls: "bg-emerald-600 text-white" },
    busy: { label: t("candBusy"), cls: "bg-amber-500 text-white" },
    unavailable: { label: t("candUnavailable"), cls: "bg-muted text-muted-foreground" },
  };

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>
          <span className="font-mono font-bold text-red-600">
            {shift.letter}
            {shift.code}
          </span>{" "}
          · {shift.facilityName}
        </DialogTitle>
        <DialogDescription>
          {shift.startTime}–{shift.endTime}
          {shift.ward ? <> · {oq("ward")}: {shift.ward}</> : null}
        </DialogDescription>
      </DialogHeader>

      {loadError ? (
        <p className="text-sm text-destructive">{t("saveError")}</p>
      ) : candidates === null ? (
        <p className="text-sm text-muted-foreground">{c("loading")}</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noCandidates")}</p>
      ) : (
        <ul className="space-y-1.5">
          {candidates.map((cand) => {
            const b = statusBadge[cand.status];
            const needsConfirm = confirmWorker === cand.workerId;
            return (
              <li
                key={cand.workerId}
                className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{cand.fullName}</div>
                  <div className="flex items-center gap-1.5">
                    <Badge className={cn("border-transparent text-[10px]", b.cls)}>{b.label}</Badge>
                    {cand.conflictTimes.length > 0 ? (
                      <span className="text-[10px] text-muted-foreground">
                        {cand.conflictTimes.join(", ")}
                      </span>
                    ) : null}
                  </div>
                </div>
                {needsConfirm ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1"
                    disabled={pending}
                    onClick={() => assign(cand.workerId, true)}
                  >
                    <TriangleAlert className="size-3.5 text-amber-600" />
                    {t("forceAssign")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="shrink-0"
                    disabled={pending}
                    onClick={() => assign(cand.workerId, false)}
                  >
                    {t("assign")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Grey-section "create order" dialog: fill a client's request straight on the
// sheet. Picks facility + shift window + ward + headcount for the clicked day
// and the current qualification tab, then creates a real open Order.
function NewOrderEditor({
  date,
  qualification,
  facilities,
  locale,
  onDone,
}: {
  date: string;
  qualification: Qualification;
  facilities: GridFacility[];
  locale: string;
  onDone: () => void;
}) {
  const t = useTranslations("masterSchedule");
  const oq = useTranslations("orderRequest");
  const c = useTranslations("common");
  const eq = useTranslations("enums.qualification");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [shift, setShift] = useState<ShiftKey>("early");
  const [clientId, setClientId] = useState("");
  const [ward, setWard] = useState("");
  const [quantity, setQuantity] = useState(1);

  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));

  const shiftLabel: Record<ShiftKey, string> = {
    early: oq("preset_early"),
    late: oq("preset_late"),
    night: oq("preset_night"),
  };

  function create() {
    if (!clientId) return;
    startTransition(async () => {
      const res = await createOpenOrderFromGrid({
        clientId,
        date,
        shift,
        qualification,
        ward: ward.trim() || undefined,
        quantity,
      });
      if (res.ok) {
        toast.success(t("orderCreated"));
        router.refresh();
        onDone();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle>{t("newOrderTitle")}</DialogTitle>
        <DialogDescription>
          {dateLabel} · {eq(qualification)}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2 rounded-md border bg-muted/30 p-2.5">
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className={field}
          aria-label={t("facility")}
        >
          <option value="">{t("selectFacility")}</option>
          {facilities.map((f) => (
            <option key={f.clientId} value={f.clientId}>
              {f.code} — {f.name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={shift}
            onChange={(e) => setShift(e.target.value as ShiftKey)}
            className={field}
            aria-label={t("shift")}
          >
            {(["early", "late", "night"] as const).map((k) => (
              <option key={k} value={k}>
                {SHIFT_LETTER[k]} · {shiftLabel[k]} ({SHIFT_PRESETS[k].start}–{SHIFT_PRESETS[k].end})
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={50}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            className={field}
            aria-label={t("quantity")}
            title={t("quantity")}
          />
        </div>
        <input
          value={ward}
          onChange={(e) => setWard(e.target.value)}
          placeholder={oq("ward")}
          className={field}
        />
        <Button
          size="sm"
          className="w-full gap-1.5"
          disabled={pending || !clientId}
          onClick={create}
        >
          <Plus className="size-4" />
          {pending ? c("loading") : t("createOrder")}
        </Button>
      </div>
    </div>
  );
}

function CellEditor({
  row,
  date,
  cell,
  facilities,
  locale,
}: {
  row: GridWorkerRow;
  date: string;
  cell: GridWorkerRow["days"][number];
  facilities: GridFacility[];
  locale: string;
}) {
  const t = useTranslations("masterSchedule");
  const oq = useTranslations("orderRequest");
  const c = useTranslations("common");
  const av = useTranslations("availability");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));

  // ── Availability (top line) ──
  const [letters, setLetters] = useState<Set<string>>(new Set(cell.avail.split("")));
  const toggleLetter = (l: string) =>
    setLetters((s) => {
      const n = new Set(s);
      if (n.has(l)) n.delete(l);
      else n.add(l);
      return n;
    });
  const availDirty =
    ["F", "S", "N"].filter((l) => letters.has(l)).join("") !== cell.avail;

  function saveAvail() {
    const value = ["F", "S", "N"].filter((l) => letters.has(l)).join("");
    startTransition(async () => {
      const res = await saveDayAvailabilityFromGrid(row.workerId, date, value);
      if (res.ok) {
        toast.success(t("saved"));
        router.refresh();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  // ── Deployments (bottom line) ──
  const [shift, setShift] = useState<ShiftKey>("early");
  const [clientId, setClientId] = useState("");
  const [ward, setWard] = useState("");
  // Set when the server rejected the assignment as busy/unavailable; the admin
  // may then explicitly force it (same override the candidate list allows).
  const [conflict, setConflict] = useState<"busy" | "unavailable" | null>(null);

  function assign(force = false) {
    if (!clientId) return;
    startTransition(async () => {
      const res = await assignFromGrid({
        workerId: row.workerId,
        date,
        shift,
        clientId,
        ward: ward.trim() || undefined,
        force,
      });
      if (res.ok) {
        setConflict(null);
        setClientId("");
        setWard("");
        toast.success(t("assigned"));
        router.refresh();
      } else if (res.error === "busy" || res.error === "unavailable") {
        setConflict(res.error);
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  function remove(assignmentId: string) {
    startTransition(async () => {
      const res = await unassignFromGrid(assignmentId);
      if (res.ok) {
        toast.success(t("removed"));
        router.refresh();
      } else {
        toast.error(res.error === "confirmed" ? t("confirmedLocked") : t("saveError"));
      }
    });
  }

  function resolveCancel(assignmentId: string, approve: boolean) {
    startTransition(async () => {
      const res = approve
        ? await approveShiftCancellation(assignmentId)
        : await rejectShiftCancellation(assignmentId);
      if (res.ok) {
        toast.success(approve ? av("cancelApproved") : av("cancelRejected"));
        router.refresh();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  const shiftLabel: Record<ShiftKey, string> = {
    early: oq("preset_early"),
    late: oq("preset_late"),
    night: oq("preset_night"),
  };

  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle>{row.name}</DialogTitle>
        <DialogDescription>{dateLabel}</DialogDescription>
      </DialogHeader>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("availabilitySection")}
        </h3>
        <div className="flex items-center gap-2">
          {(["early", "late", "night"] as const).map((k) => {
            const l = SHIFT_LETTER[k];
            const active = letters.has(l);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleLetter(l)}
                className={cn(
                  "flex-1 rounded-md border px-2 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {l} · {shiftLabel[k]}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{t("availabilityHint")}</p>
          <Button size="sm" onClick={saveAvail} disabled={pending || !availDirty}>
            {pending ? c("loading") : c("save")}
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("deploymentsSection")}
        </h3>
        {cell.jobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("noDeployments")}</p>
        ) : (
          <ul className="space-y-1.5">
            {cell.jobs.map((j) => (
              <li
                key={j.assignmentId}
                className={cn(
                  "space-y-1.5 rounded-md border px-2 py-1.5",
                  j.cancelRequested && "border-amber-500/60 bg-amber-500/5",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      <span className="font-mono font-bold text-red-600">
                        {j.letter}
                        {j.code}
                      </span>{" "}
                      · {j.facilityName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {j.startTime}–{j.endTime}
                      {j.ward ? <> · {oq("ward")}: {j.ward}</> : null}
                    </div>
                  </div>
                  {j.clientConfirmed ? (
                    <Badge className="shrink-0 gap-1 border-transparent bg-emerald-600 text-white">
                      <CheckCircle2 className="size-3" />
                      {t("confirmedShort")}
                    </Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-destructive hover:bg-destructive/10"
                      disabled={pending}
                      onClick={() => remove(j.assignmentId)}
                      aria-label={c("delete")}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>

                {/* Pending worker cancellation request → note + approve/reject. */}
                {j.cancelRequested && !j.clientConfirmed ? (
                  <div className="space-y-1.5 border-t border-amber-500/30 pt-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                      <TriangleAlert className="size-3.5" />
                      {av("cancelRequestedBadge")}
                    </div>
                    {j.cancelNote ? (
                      <p className="text-xs text-muted-foreground">“{j.cancelNote}”</p>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-7 flex-1 gap-1"
                        disabled={pending}
                        onClick={() => resolveCancel(j.assignmentId, true)}
                      >
                        <CheckCircle2 className="size-3.5" />
                        {av("approveCancel")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 flex-1 gap-1"
                        disabled={pending}
                        onClick={() => resolveCancel(j.assignmentId, false)}
                      >
                        {av("rejectCancel")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 rounded-md border bg-muted/30 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={shift}
              onChange={(e) => {
                setShift(e.target.value as ShiftKey);
                setConflict(null);
              }}
              className={field}
              aria-label={t("shift")}
            >
              {(["early", "late", "night"] as const).map((k) => (
                <option key={k} value={k}>
                  {SHIFT_LETTER[k]} · {shiftLabel[k]}
                </option>
              ))}
            </select>
            <input
              value={ward}
              onChange={(e) => setWard(e.target.value)}
              placeholder={oq("ward")}
              className={field}
            />
          </div>
          <select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setConflict(null);
            }}
            className={field}
            aria-label={t("facility")}
          >
            <option value="">{t("selectFacility")}</option>
            {facilities.map((f) => (
              <option key={f.clientId} value={f.clientId}>
                {f.code} — {f.name}
              </option>
            ))}
          </select>

          {conflict ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="space-y-1.5">
                <p>{conflict === "busy" ? t("busyWarning") : t("unavailableWarning")}</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => assign(true)}
                >
                  {t("forceAssign")}
                </Button>
              </div>
            </div>
          ) : null}

          <Button
            size="sm"
            className="w-full gap-1.5"
            disabled={pending || !clientId}
            onClick={() => assign(false)}
          >
            <Plus className="size-4" />
            {pending ? c("loading") : t("assign")}
          </Button>
        </div>
      </section>
    </div>
  );
}
