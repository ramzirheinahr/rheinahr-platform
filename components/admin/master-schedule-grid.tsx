"use client";

import { useMemo, useState, useTransition, Fragment } from "react";
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
import { CheckCircle2, Plus, Trash2, TriangleAlert } from "lucide-react";
import type { GridFacility, GridWorkerRow, ShiftKey } from "@/lib/master-schedule-core";
import {
  assignFromGrid,
  saveDayAvailabilityFromGrid,
  unassignFromGrid,
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
  rows,
  facilities,
}: {
  year: number;
  month: number;
  rows: GridWorkerRow[];
  facilities: GridFacility[];
}) {
  const t = useTranslations("masterSchedule");
  const locale = useLocale();

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const holidays = useMemo(() => germanHolidays(year), [year]);

  const days = useMemo(
    () =>
      Array.from({ length: daysInMonth }, (_, i) => {
        const date = `${year}-${pad(month)}-${pad(i + 1)}`;
        const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
        return {
          day: i + 1,
          date,
          weekend: dow === 0 || dow === 6,
          holiday: holidays.get(date),
        };
      }),
    [year, month, daysInMonth, holidays],
  );

  const [target, setTarget] = useState<{ workerId: string; day: number } | null>(null);
  const targetRow = target ? rows.find((r) => r.workerId === target.workerId) : undefined;

  if (rows.length === 0) {
    return <p className="rounded-lg border p-6 text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <>
      <div dir="ltr" className="overflow-x-auto rounded-lg border">
        <table className="border-collapse text-[11px] leading-tight">
          <thead>
            <tr>
              <th className="sticky start-0 z-10 min-w-40 border border-rose-950 bg-rose-950 p-1.5 text-start text-xs font-semibold text-white">
                {t("nameHeader")}
              </th>
              {days.map((d) => (
                <th
                  key={d.day}
                  title={d.holiday ?? undefined}
                  className={cn(
                    "min-w-8 border border-rose-950/40 bg-rose-950 p-1 text-center text-[11px] font-semibold text-white",
                    (d.weekend || d.holiday) && "bg-rose-800",
                  )}
                >
                  {pad(d.day)}.
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
                    {r.name}
                  </th>
                  {r.days.map((cell, i) => {
                    const d = days[i];
                    const confirmedJob = cell.jobs.find((j) => j.clientConfirmed);
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
                          "h-6 cursor-pointer border p-0.5 text-center align-middle font-medium hover:ring-2 hover:ring-ring/60 hover:ring-inset",
                          (d.weekend || d.holiday) && "bg-rose-500/15",
                          confirmedJob && "bg-emerald-600 font-bold text-white",
                        )}
                      >
                        {confirmedJob ? confirmedJob.ward || "0" : cell.avail}
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
                          (d.weekend || d.holiday) && "bg-rose-500/15",
                        )}
                      >
                        {cell.jobs.map((j) => (
                          <span
                            key={j.assignmentId}
                            title={`${j.facilityName} · ${j.startTime}–${j.endTime}`}
                            className={cn("px-0.5", j.status === "pending" && "opacity-50")}
                          >
                            {j.letter}
                            {j.code}
                          </span>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
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
    </>
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
                className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5"
              >
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
