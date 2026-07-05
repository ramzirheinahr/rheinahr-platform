"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { UserPlus, X, CheckSquare, Users, Search } from "lucide-react";
import {
  getBulkCandidates,
  bulkAssignWorkers,
} from "@/app/[locale]/admin/orders/actions";
import type { BulkCandidate, BulkShift } from "@/lib/orders";

// Smart, forgiving filter: the query is split into tokens and each token must
// match the START of some word in the text (or appear anywhere as a fallback).
// So "ah mu" matches "Ahmed Muster" — type part of the first word, a space, then
// part of the next, in any order, without needing the full name.
function smartMatch(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = text.toLowerCase();
  const words = hay.split(/[\s@._-]+/).filter(Boolean);
  return q.split(/\s+/).every(
    (tok) => words.some((w) => w.startsWith(tok)) || hay.includes(tok),
  );
}

// ── Multi-select context ──────────────────────────────────────────────────
// Lets the admin tick several shift cells (by orderId) across the whole request
// table, then offer them to several workers at once. `useAssignSelection`
// returns null outside the provider, so the shared ShiftMetaCell keeps working
// unchanged in client/read-only contexts.
type SelectionCtx = {
  isSelected: (orderId: string) => boolean;
  toggle: (orderId: string) => void;
};
const Ctx = createContext<SelectionCtx | null>(null);
export function useAssignSelection() {
  return useContext(Ctx);
}

export function AssignSelectionProvider({
  selectableOrderIds,
  children,
}: {
  selectableOrderIds: string[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (orderId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  const clear = () => setSelected(new Set());
  const selectAll = () => setSelected(new Set(selectableOrderIds));

  return (
    <Ctx.Provider value={{ isSelected: (id) => selected.has(id), toggle }}>
      {children}
      <BulkAssignBar
        orderIds={[...selected]}
        totalSelectable={selectableOrderIds.length}
        onClear={clear}
        onSelectAll={selectAll}
      />
    </Ctx.Provider>
  );
}

// ── Sticky action bar ─────────────────────────────────────────────────────
function BulkAssignBar({
  orderIds,
  totalSelectable,
  onClear,
  onSelectAll,
}: {
  orderIds: string[];
  totalSelectable: number;
  onClear: () => void;
  onSelectAll: () => void;
}) {
  const t = useTranslations("orders");
  const [open, setOpen] = useState(false);
  if (orderIds.length === 0) return null;

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
        <div className="flex flex-wrap items-center gap-2 rounded-full border bg-popover/95 px-4 py-2 shadow-lg backdrop-blur">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <CheckSquare className="size-4 text-primary" />
            {t("selectedCount", { count: orderIds.length })}
          </span>
          {orderIds.length < totalSelectable ? (
            <Button variant="ghost" size="sm" onClick={onSelectAll}>
              {t("selectAll", { count: totalSelectable })}
            </Button>
          ) : null}
          <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
            <UserPlus className="size-4" />
            {t("assignSelected")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={onClear}
          >
            <X className="size-4" />
            {t("clearSelection")}
          </Button>
        </div>
      </div>
      <BulkAssignDialog
        orderIds={orderIds}
        open={open}
        onOpenChange={setOpen}
        onDone={onClear}
      />
    </>
  );
}

// ── Bulk-assign dialog ────────────────────────────────────────────────────
function BulkAssignDialog({
  orderIds,
  open,
  onOpenChange,
  onDone,
}: {
  orderIds: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const t = useTranslations("orders");
  const c = useTranslations("common");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [shifts, setShifts] = useState<BulkShift[]>([]);
  const [candidates, setCandidates] = useState<BulkCandidate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [force, setForce] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const filtered = candidates.filter((cand) =>
    smartMatch(`${cand.fullName} ${cand.email}`, query),
  );
  const allFilteredPicked =
    filtered.length > 0 && filtered.every((cand) => picked.has(cand.workerId));

  function toggleAllFiltered() {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allFilteredPicked) filtered.forEach((cand) => next.delete(cand.workerId));
      else filtered.forEach((cand) => next.add(cand.workerId));
      return next;
    });
  }

  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    setForce(false);
    setQuery("");
    setLoading(true);
    getBulkCandidates(orderIds)
      .then((res) => {
        if (res.ok) {
          setShifts(res.shifts);
          setCandidates(res.candidates);
        } else {
          toast.error(t("saveError"));
        }
      })
      .finally(() => setLoading(false));
    // orderIds identity changes each render; key on the joined value instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderIds.join(",")]);

  const togglePick = (workerId: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });

  function submit() {
    if (picked.size === 0) return;
    startTransition(async () => {
      const res = await bulkAssignWorkers(orderIds, [...picked], force);
      if (res.ok) {
        toast.success(
          t("bulkResult", { created: res.created ?? 0, skipped: res.skipped ?? 0 }),
        );
        onOpenChange(false);
        onDone();
        router.refresh();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("bulkAssignTitle")}</DialogTitle>
          <DialogDescription>
            {t("bulkAssignDesc", { count: orderIds.length })}
          </DialogDescription>
        </DialogHeader>

        {/* Selected shifts summary */}
        <div className="flex flex-wrap gap-1.5">
          {shifts.map((s) => (
            <Badge key={s.id} variant="secondary" className="font-normal">
              {s.label}
            </Badge>
          ))}
        </div>

        {/* Candidate workers */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Users className="size-4 text-muted-foreground" />
              {t("chooseWorkers")}
            </h3>
            {!loading && candidates.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={toggleAllFiltered}
                disabled={filtered.length === 0}
              >
                <CheckSquare className="size-4" />
                {allFilteredPicked ? t("deselectAllWorkers") : t("selectAllWorkers")}
              </Button>
            ) : null}
          </div>

          {!loading && candidates.length > 0 ? (
            <div className="relative">
              <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchWorkers")}
                className="ps-8"
                aria-label={t("searchWorkers")}
              />
            </div>
          ) : null}

          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{c("loading")}</p>
          ) : candidates.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("noEligible")}</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("noSearchMatch")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {filtered.map((cand) => {
                const checked = picked.has(cand.workerId);
                return (
                  <li key={cand.workerId}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/40",
                        checked && "bg-primary/5",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePick(cand.workerId)}
                        className="size-4 accent-primary"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{cand.fullName}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {cand.email}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {cand.availableCount > 0 ? (
                          <Badge variant="secondary" className="bg-primary/10 text-primary">
                            {t("nAvailable", { n: cand.availableCount })}
                          </Badge>
                        ) : null}
                        {cand.busyCount > 0 ? (
                          <Badge variant="secondary" className="bg-amber-500/15 text-amber-600">
                            {t("nBusy", { n: cand.busyCount })}
                          </Badge>
                        ) : null}
                        {cand.unavailableCount > 0 ? (
                          <Badge variant="destructive">
                            {t("nOff", { n: cand.unavailableCount })}
                          </Badge>
                        ) : null}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Force override + submit */}
        <label className="flex items-start gap-2.5 rounded-lg border bg-muted/20 p-3 text-sm">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="text-muted-foreground">{t("forceOverrideHint")}</span>
        </label>

        <Button
          className="w-full gap-2"
          disabled={picked.size === 0 || pending}
          onClick={submit}
        >
          <UserPlus className="size-4" />
          {pending
            ? c("loading")
            : t("assignToShifts", { workers: picked.size, shifts: orderIds.length })}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
