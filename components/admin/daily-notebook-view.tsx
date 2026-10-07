"use client";

import { useState, useTransition, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect, filterOptions } from "@/components/ui/searchable-select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Printer,
  Plus,
  Search,
  Calendar,
  Clock,
  Building2,
  User,
  Trash2,
  UserMinus,
  CheckCircle2,
  CalendarDays,
  PenTool,
  Save,
  Check,
  AlertCircle,
  HelpCircle,
  FileText,
  MessageCircle,
  RefreshCw,
  UserCheck,
  Building,
  LayoutList,
} from "lucide-react";
import {
  MORNING_SLOTS,
  AFTERNOON_SLOTS,
  type DailyNotebookData,
  type DailyNotebookShift,
  type AvailableWorker,
  type MiniCalendarDay,
} from "@/lib/daily-notebook";
import { qualifications, type Qualification } from "@/lib/validations";
import {
  saveDailyNote,
  acceptAssignmentOnBehalfOfWorker,
  replaceWorkerOnAssignment,
} from "@/app/[locale]/admin/schedule/book/actions";
import {
  candidatesForOrder,
  assignWorkerToOrder,
  unassignFromGrid,
  deleteShiftFromGrid,
  createOpenOrderFromGrid,
} from "@/app/[locale]/admin/schedule/actions";
import { shiftLetterForStart, type ShiftKey } from "@/lib/master-schedule-core";
import type { Candidate } from "@/lib/orders";

function getShiftWhatsAppUrl(shift: DailyNotebookShift, dateStr: string) {
  if (!shift.workerPhone) return "";
  const cleanPhone = shift.workerPhone.replace(/[^\d+]/g, "").replace(/^\+/, "");
  const [y, m, d] = dateStr.split("-");
  const text =
    `Hallo ${shift.workerName},\n\n` +
    `Hier sind deine Einsatzdetails für den Dienst am ${d}.${m}.${y}:\n\n` +
    `Einrichtung: ${shift.facilityName}\n` +
    (shift.facilityAddress
      ? `Adresse: ${shift.facilityAddress}\nKarte: https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          shift.facilityAddress
        )}\n`
      : "") +
    (shift.ward ? `Wohnbereich: ${shift.ward}\n` : "") +
    `Uhrzeit: ${shift.startTime} - ${shift.endTime}` +
    (shift.breakMinutes ? `\nPause: ${shift.breakMinutes} Min.` : "") +
    `\n\nBitte bestätige kurz deinen Einsatz. Vielen Dank!\nRheinAhr Dienstleistungen GmbH`;
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

function getWorkerWhatsAppUrl(w: { fullName: string; phone: string | null }, dateStr: string) {
  if (!w.phone) return "";
  const cleanPhone = w.phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
  const [y, m, d] = dateStr.split("-");
  const text =
    `Hallo ${w.fullName},\n\n` +
    `Bist du heute am ${d}.${m}.${y} verfügbar für einen Einsatz?\n\nRheinAhr Dienstleistungen GmbH`;
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

export function DailyNotebookView({
  data,
  qualificationFilter = "all",
}: {
  data: DailyNotebookData;
  qualificationFilter?: string;
}) {
  const t = useTranslations("dailyNotebook");
  const tm = useTranslations("masterSchedule");
  const oq = useTranslations("orderRequest");
  const eq = useTranslations("enums.qualification");
  const locale = useLocale();
  const router = useRouter();

  const [isPending, startTransition] = useTransition();

  // Search filter
  const [searchQuery, setSearchQuery] = useState("");

  // Notes state
  const [noteContent, setNoteContent] = useState(data.dailyNote);
  const [isSavingNote, setIsSavingNote] = useState(false);

  // Available workers filter toggle ("free" = only unassigned, "all" = all)
  const [workerFilter, setWorkerFilter] = useState<"free" | "all">("free");

  // Selected shift for details modal
  const [selectedShift, setSelectedShift] = useState<DailyNotebookShift | null>(null);

  // Accept on behalf of worker state
  const [isAcceptingOnBehalf, setIsAcceptingOnBehalf] = useState(false);

  // Change worker mode inside Shift Details modal
  const [isChangingWorker, setIsChangingWorker] = useState(false);
  const [changeCandidates, setChangeCandidates] = useState<Candidate[] | null>(null);
  const [loadingChangeCandidates, setLoadingChangeCandidates] = useState(false);
  const [replacingWorkerId, setReplacingWorkerId] = useState<string | null>(null);

  // Assign available worker from right box to an open shift
  const [workerToAssign, setWorkerToAssign] = useState<AvailableWorker | null>(null);

  // Unassigned shift selected for worker assignment modal
  const [assigningShift, setAssigningShift] = useState<DailyNotebookShift | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [assigningWorkerId, setAssigningWorkerId] = useState<string | null>(null);

  // Add new shift modal
  const [isAddingShift, setIsAddingShift] = useState(false);
  const [newShiftSlot, setNewShiftSlot] = useState<string>("06:00");
  const [newShiftClientId, setNewShiftClientId] = useState<string>("");
  const [newShiftStartTime, setNewShiftStartTime] = useState<string>("06:00");
  const [newShiftEndTime, setNewShiftEndTime] = useState<string>("14:30");
  const [newShiftBreak, setNewShiftBreak] = useState<number>(30);
  const [newShiftWard, setNewShiftWard] = useState<string>("");
  const [newShiftQuantity, setNewShiftQuantity] = useState<number>(1);
  const [newShiftQual, setNewShiftQual] = useState<Qualification>("pflegefachkraft");

  // View grouping mode: "client" (group by client: F, S, N) or "time" (classic timeline slots)
  const [sortMode, setSortMode] = useState<"client" | "time">("client");

  // Filter shifts based on query
  const filteredShifts = useMemo(() => {
    if (!searchQuery.trim()) return data.shifts;
    const q = searchQuery.toLowerCase().trim();
    return data.shifts.filter(
      (s) =>
        s.facilityName.toLowerCase().includes(q) ||
        (s.workerName && s.workerName.toLowerCase().includes(q)) ||
        (s.ward && s.ward.toLowerCase().includes(q))
    );
  }, [data.shifts, searchQuery]);

  // Group shifts by Client (Facility), then under each client: Morning (F), Afternoon/Late (S), Night (N)
  const clientGroupedShifts = useMemo(() => {
    type ClientGroup = {
      facilityId: string;
      facilityName: string;
      facilityShortCode?: string | null;
      facilityAddress?: string | null;
      morning: DailyNotebookShift[];   // F (Frühdienst)
      late: DailyNotebookShift[];      // S (Spätdienst)
      night: DailyNotebookShift[];     // N (Nachtdienst)
      totalCount: number;
    };

    const map = new Map<string, ClientGroup>();

    for (const shift of filteredShifts) {
      let group = map.get(shift.facilityId);
      if (!group) {
        group = {
          facilityId: shift.facilityId,
          facilityName: shift.facilityName,
          facilityShortCode: shift.facilityShortCode,
          facilityAddress: shift.facilityAddress,
          morning: [],
          late: [],
          night: [],
          totalCount: 0,
        };
        map.set(shift.facilityId, group);
      }

      group.totalCount++;
      if (shift.shiftLetter === "F") {
        group.morning.push(shift);
      } else if (shift.shiftLetter === "S") {
        group.late.push(shift);
      } else {
        group.night.push(shift);
      }
    }

    // Sort shifts inside each subgroup by startTime
    for (const g of map.values()) {
      g.morning.sort((a, b) => a.startTime.localeCompare(b.startTime));
      g.late.sort((a, b) => a.startTime.localeCompare(b.startTime));
      g.night.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }

    // Sort clients alphabetically by facilityName
    return Array.from(map.values()).sort((a, b) =>
      a.facilityName.localeCompare(b.facilityName, "de")
    );
  }, [filteredShifts]);

  // Lookup shift list by slot
  const shiftsBySlot = useMemo(() => {
    const map: Record<string, DailyNotebookShift[]> = {};
    for (const s of filteredShifts) {
      const slot = s.startTime;
      if (!map[slot]) map[slot] = [];
      map[slot].push(s);
    }
    return map;
  }, [filteredShifts]);

  // Shifts in night section (starts before 06:00 or at/after 20:00)
  const nightShifts = useMemo(() => {
    return filteredShifts.filter((s) => {
      const h = Number(s.startTime.split(":")[0]) || 0;
      return h >= 20 || h < 6;
    });
  }, [filteredShifts]);

  // Unassigned shifts on this day
  const unassignedShiftsList = useMemo(() => {
    return data.shifts.filter((s) => s.isUnassigned);
  }, [data.shifts]);

  // Filter available workers for the right column box
  const filteredAvailableWorkers = useMemo(() => {
    const list = data.availableWorkers || [];
    const filtered = workerFilter === "free" ? list.filter((w) => w.status === "free") : list;

    const statusPriority: Record<string, number> = {
      freeWithShifts: 0,
      free: 1,
      busy: 2,
      off: 3,
      leave: 4,
    };

    return [...filtered].sort((a, b) => {
      const aKey = a.status === "free" && a.availLetters && a.availLetters !== "Urlaub" && a.availLetters !== "OFF" ? "freeWithShifts" : a.status;
      const bKey = b.status === "free" && b.availLetters && b.availLetters !== "Urlaub" && b.availLetters !== "OFF" ? "freeWithShifts" : b.status;
      const aPrio = statusPriority[aKey] ?? 99;
      const bPrio = statusPriority[bKey] ?? 99;

      if (aPrio !== bPrio) {
        return aPrio - bPrio;
      }
      return a.fullName.localeCompare(b.fullName, "de");
    });
  }, [data.availableWorkers, workerFilter]);

  // Handle open candidate modal
  async function handleOpenCandidateModal(shift: DailyNotebookShift) {
    setAssigningShift(shift);
    setCandidates(null);
    setLoadingCandidates(true);
    setCandidateSearch("");
    try {
      const list = await candidatesForOrder(shift.orderId);
      if (list.ok) {
        setCandidates(list.candidates);
      } else {
        setCandidates([]);
        toast.error(tm("saveError"));
      }
    } catch (err) {
      toast.error(tm("saveError"));
    } finally {
      setLoadingCandidates(false);
    }
  }

  // Handle assign worker
  async function handleAssignWorker(workerId: string, force = false) {
    if (!assigningShift) return;
    setAssigningWorkerId(workerId);
    try {
      const res = await assignWorkerToOrder(assigningShift.orderId, workerId, force);
      if (res.ok) {
        toast.success(tm("assigned"));
        setAssigningShift(null);
        startTransition(() => {
          router.refresh();
        });
      } else {
        if (res.error === "busy" || res.error === "unavailable") {
          toast.warning(
            res.error === "busy" ? tm("busyWarning") : tm("unavailableWarning"),
            {
              action: {
                label: tm("forceAssign"),
                onClick: () => handleAssignWorker(workerId, true),
              },
            }
          );
        } else {
          toast.error(tm("saveError"));
        }
      }
    } catch {
      toast.error(tm("saveError"));
    } finally {
      setAssigningWorkerId(null);
    }
  }

  // Handle assign available worker to an open shift
  async function handleAssignWorkerToOpenShift(workerId: string, orderId: string, force = true) {
    setAssigningWorkerId(workerId);
    try {
      const res = await assignWorkerToOrder(orderId, workerId, force);
      if (res.ok) {
        toast.success(tm("assigned"));
        setWorkerToAssign(null);
        startTransition(() => {
          router.refresh();
        });
      } else {
        if (res.error === "busy" || res.error === "unavailable") {
          toast.warning(
            res.error === "busy" ? tm("busyWarning") : tm("unavailableWarning"),
            {
              action: {
                label: tm("forceAssign"),
                onClick: () => handleAssignWorkerToOpenShift(workerId, orderId, true),
              },
            }
          );
        } else {
          toast.error(tm("saveError"));
        }
      }
    } catch {
      toast.error(tm("saveError"));
    } finally {
      setAssigningWorkerId(null);
    }
  }

  // Handle unassign worker
  async function handleUnassign(assignmentId: string) {
    try {
      const res = await unassignFromGrid(assignmentId);
      if (res.ok) {
        toast.success(tm("removed"));
        setSelectedShift(null);
        startTransition(() => {
          router.refresh();
        });
      } else {
        toast.error(tm("saveError"));
      }
    } catch {
      toast.error(tm("saveError"));
    }
  }

  // Handle accept assignment on behalf of worker immediately
  async function handleAcceptOnBehalf() {
    if (!selectedShift?.assignmentId) return;
    setIsAcceptingOnBehalf(true);
    try {
      const res = await acceptAssignmentOnBehalfOfWorker(selectedShift.assignmentId);
      if (res.ok) {
        toast.success(t("acceptOnBehalfSuccess"));
        setSelectedShift((prev) => (prev ? { ...prev, status: "confirmed" } : null));
        startTransition(() => {
          router.refresh();
        });
      } else {
        toast.error(tm("saveError"));
      }
    } catch {
      toast.error(tm("saveError"));
    } finally {
      setIsAcceptingOnBehalf(false);
    }
  }

  // Handle opening change worker mode
  async function openChangeWorkerMode() {
    if (!selectedShift) return;
    setIsChangingWorker(true);
    setChangeCandidates(null);
    setLoadingChangeCandidates(true);
    try {
      const res = await candidatesForOrder(selectedShift.orderId);
      if (res.ok) {
        setChangeCandidates(res.candidates.filter((c) => c.workerId !== selectedShift.workerId));
      } else {
        setChangeCandidates([]);
      }
    } catch {
      setChangeCandidates([]);
    } finally {
      setLoadingChangeCandidates(false);
    }
  }

  // Handle replacing worker on existing assignment
  async function handleReplaceWorker(newWorkerId: string, force = false) {
    if (!selectedShift?.assignmentId) return;
    setReplacingWorkerId(newWorkerId);
    try {
      const res = await replaceWorkerOnAssignment(selectedShift.assignmentId, newWorkerId, force);
      if (res.ok) {
        toast.success(t("workerReplaced"));
        setIsChangingWorker(false);
        setSelectedShift(null);
        startTransition(() => {
          router.refresh();
        });
      } else {
        if (res.error === "busy" || res.error === "unavailable") {
          toast.warning(
            res.error === "busy" ? tm("busyWarning") : tm("unavailableWarning"),
            {
              action: {
                label: tm("forceAssign"),
                onClick: () => handleReplaceWorker(newWorkerId, true),
              },
            }
          );
        } else {
          toast.error(tm("saveError"));
        }
      }
    } catch {
      toast.error(tm("saveError"));
    } finally {
      setReplacingWorkerId(null);
    }
  }

  // Handle delete shift
  async function handleDeleteShift(assignmentId: string) {
    try {
      const res = await deleteShiftFromGrid(assignmentId);
      if (res.ok) {
        toast.success(tm("shiftDeleted"));
        setSelectedShift(null);
        startTransition(() => {
          router.refresh();
        });
      } else {
        toast.error(tm("saveError"));
      }
    } catch {
      toast.error(tm("saveError"));
    }
  }

  // Handle save daily notes
  async function handleSaveNote() {
    setIsSavingNote(true);
    try {
      const res = await saveDailyNote(data.dateStr, noteContent);
      if (res.ok) {
        toast.success(t("notesSaved"));
      } else {
        toast.error(tm("saveError"));
      }
    } catch {
      toast.error(tm("saveError"));
    } finally {
      setIsSavingNote(false);
    }
  }

  // Handle create new shift
  async function handleCreateNewShift() {
    if (!newShiftClientId) {
      toast.error(tm("selectFacility"));
      return;
    }
    try {
      const letter = shiftLetterForStart(newShiftStartTime);
      const shiftKey: ShiftKey = letter === "F" ? "early" : letter === "S" ? "late" : "night";

      const res = await createOpenOrderFromGrid({
        date: data.dateStr,
        shift: shiftKey,
        startTime: newShiftStartTime,
        endTime: newShiftEndTime,
        breakMinutes: newShiftBreak,
        clientId: newShiftClientId,
        qualification: newShiftQual,
        quantity: newShiftQuantity,
        ward: newShiftWard.trim() || undefined,
      });
      if (res.ok) {
        toast.success(tm("orderCreated"));
        setIsAddingShift(false);
        startTransition(() => {
          router.refresh();
        });
      } else {
        toast.error(tm("saveError"));
      }
    } catch {
      toast.error(tm("saveError"));
    }
  }

  function openAddShiftAtSlot(slot: string) {
    setNewShiftSlot(slot);
    setNewShiftStartTime(slot);
    const [h, m] = slot.split(":").map(Number);
    const endH = (h + 8) % 24;
    setNewShiftEndTime(`${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    setIsAddingShift(true);
  }

  // Filter candidates in dialog
  const filteredCandidates = useMemo(() => {
    if (!candidates) return [];
    if (!candidateSearch.trim()) return candidates;
    const q = candidateSearch.toLowerCase().trim();
    return candidates.filter((c) => c.fullName.toLowerCase().includes(q));
  }, [candidates, candidateSearch]);

  // Facility options for select dropdown
  const facilityOptions = useMemo(() => {
    return data.facilities.map((f) => ({
      value: f.id,
      label: f.shortCode ? `[${f.shortCode}] ${f.facilityName}` : f.facilityName,
    }));
  }, [data.facilities]);

  const candidateStatusBadge: Record<Candidate["status"], { label: string; cls: string }> = {
    available: { label: tm("candAvailable"), cls: "bg-emerald-600 text-white" },
    busy: { label: tm("candBusy"), cls: "bg-amber-500 text-white" },
    unavailable: { label: tm("candUnavailable"), cls: "bg-muted text-muted-foreground" },
  };

  return (
    <div className="space-y-6">
      {/* Top action / navigation header */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("title")}</h1>
            <Badge variant="outline" className="font-mono text-xs">
              {t("calendarWeek", { week: data.calendarWeek })}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Switcher to Monthly Grid */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            render={<Link href={`/admin/schedule?year=${data.year}&month=${data.month}`} />}
          >
            <CalendarDays className="size-4" />
            {t("monthView")}
          </Button>

          {/* Print button */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => window.print()}
          >
            <Printer className="size-4" />
            {t("print")}
          </Button>

          {/* Add shift button */}
          <Button
            size="sm"
            className="gap-2"
            onClick={() => openAddShiftAtSlot("06:00")}
          >
            <Plus className="size-4" />
            {t("addShift")}
          </Button>
        </div>
      </div>

      {/* Date navigation and filters bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3 shadow-xs no-print">
        {/* Date Stepper */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="size-8 p-0"
            render={
              <Link
                href={`/admin/schedule/book?date=${data.prevDateStr}${
                  qualificationFilter !== "all" ? `&qualification=${qualificationFilter}` : ""
                }`}
              />
            }
          >
            <ChevronLeft className="size-4 rtl:rotate-180" />
            <span className="sr-only">{t("prevDay")}</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs font-medium"
            render={
              <Link
                href={`/admin/schedule/book?date=${new Date().toISOString().slice(0, 10)}${
                  qualificationFilter !== "all" ? `&qualification=${qualificationFilter}` : ""
                }`}
              />
            }
          >
            {t("today")}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="size-8 p-0"
            render={
              <Link
                href={`/admin/schedule/book?date=${data.nextDateStr}${
                  qualificationFilter !== "all" ? `&qualification=${qualificationFilter}` : ""
                }`}
              />
            }
          >
            <ChevronRight className="size-4 rtl:rotate-180" />
            <span className="sr-only">{t("nextDay")}</span>
          </Button>

          <div className="relative ms-1">
            <Input
              type="date"
              value={data.dateStr}
              onChange={(e) => {
                if (e.target.value) {
                  router.push(
                    `/admin/schedule/book?date=${e.target.value}${
                      qualificationFilter !== "all" ? `&qualification=${qualificationFilter}` : ""
                    }`
                  );
                }
              }}
              className="h-8 w-36 text-xs"
            />
          </div>
        </div>

        {/* Qualification filter tabs */}
        <div className="flex flex-wrap items-center gap-1">
          <Link
            href={`/admin/schedule/book?date=${data.dateStr}`}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              qualificationFilter === "all"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {t("allQualifications")}
          </Link>
          {qualifications.map((q) => (
            <Link
              key={q}
              href={`/admin/schedule/book?date=${data.dateStr}&qualification=${q}`}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                qualificationFilter === q
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {eq(q)}
            </Link>
          ))}
        </div>

        {/* Sort Mode Toggle: By Client (Default) vs By Time */}
        <div className="flex items-center rounded-lg border bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={() => setSortMode("client")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              sortMode === "client"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
            title={t("groupByClient")}
          >
            <Building className="size-3.5" />
            <span>{t("groupByClient")}</span>
          </button>
          <button
            type="button"
            onClick={() => setSortMode("time")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              sortMode === "time"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
            title={t("sortByTime")}
          >
            <Clock className="size-3.5" />
            <span>{t("sortByTime")}</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("filterSearch")}
            className="h-8 ps-8 text-xs"
          />
        </div>
      </div>

      {/* Summary stats pill bar */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground no-print">
        <span className="font-semibold text-foreground">
          {t("summaryTotalShifts")}: {data.stats.totalShifts}
        </span>
        <span>•</span>
        <span className="text-emerald-700 dark:text-emerald-400">
          {t("summaryAssigned")}: {data.stats.assignedCount}
        </span>
        <span>•</span>
        <span className="text-amber-700 dark:text-amber-400">
          {t("summaryUnassigned")}: {data.stats.unassignedCount}
        </span>
        <span>•</span>
        <span>
          {t("summaryStaff")}: {data.stats.workersCount}
        </span>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          THE NOTEBOOK CONTAINER (CALENDAR PLANNER BOOK)
          Faithful recreation of the user's physical spiral diary!
         ───────────────────────────────────────────────────────────── */}
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-2xl border border-stone-300/80 bg-[#fdfbf7] p-2 shadow-2xl transition-all sm:p-6 print:border-none print:bg-white print:p-0 print:shadow-none">
        {/* Left Spiral Binding Rings (Screen view only) */}
        <div className="pointer-events-none absolute bottom-0 start-1 top-0 z-20 flex w-7 flex-col justify-around py-4 sm:start-2 print:hidden">
          {Array.from({ length: 24 }).map((_, idx) => (
            <div key={idx} className="relative flex items-center">
              {/* Hole in paper */}
              <div className="size-3 rounded-full border border-stone-400/80 bg-stone-700/60 shadow-inner" />
              {/* Metallic Ring Loop */}
              <div className="absolute -start-2 h-4 w-7 rounded-full border-2 border-stone-600 bg-gradient-to-r from-stone-400 via-stone-200 to-stone-500 shadow-md" />
            </div>
          ))}
        </div>

        {/* Notebook Main Paper Surface (Indented from spiral) */}
        <div className="ps-8 sm:ps-10">
          {/* Header of Notebook Page: Big Day Number + Month & Day + KW + Day Count */}
          <div className="border-b-2 border-slate-700/80 pb-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              {/* Big Day Number & Day Name */}
              <div className="flex items-baseline gap-3">
                <span className="font-serif text-5xl font-black tracking-tight text-slate-900 sm:text-6xl">
                  {data.day}
                </span>
                <div>
                  <div className="font-sans text-xl font-black tracking-wider text-slate-800 sm:text-2xl">
                    {data.dayOfWeekName} {data.monthName}
                  </div>
                  <div className="text-xs font-semibold text-slate-500">
                    {new Intl.DateTimeFormat(locale, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }).format(new Date(Date.UTC(data.year, data.month - 1, data.day)))}
                  </div>
                </div>
              </div>

              {/* Top Right: Year, Day Countdown, Calendar Week (KW) */}
              <div className="text-end font-mono">
                <div className="flex items-center justify-end gap-2 text-sm font-bold text-slate-800 sm:text-base">
                  <span>{data.year}</span>
                  <span className="text-xs text-slate-500">
                    {data.dayOfYear}-{data.daysRemaining}
                  </span>
                  <span className="rounded bg-slate-200/90 px-1.5 py-0.5 text-xs font-bold text-slate-900">
                    {data.calendarWeek}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {t("dayProgress", { current: data.dayOfYear, remaining: data.daysRemaining })}
                </div>
              </div>
            </div>
          </div>

          {/* ─────────────────────────────────────────────────────────
              MAIN CONTENT: SORT BY CLIENT (Default) OR BY TIME (Timeline)
             ───────────────────────────────────────────────────────── */}
          {sortMode === "client" ? (
            /* ─────────────────────────────────────────────────────────
                CLIENT-FIRST GROUPING VIEW
                Each Client as a section, with:
                  - Frühdienst (F) / Morning Shift
                  - Spätdienst (S) / Afternoon / Late Shift
                  - Nachtdienst (N) / Night Shift
               ───────────────────────────────────────────────────────── */
            <div className="space-y-4 pt-3">
              {clientGroupedShifts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 py-12 text-center text-sm text-slate-500">
                  <Building className="mx-auto mb-2 size-8 text-slate-400" />
                  <p>{t("noShiftsForDay")}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {clientGroupedShifts.map((group) => (
                    <div
                      key={group.facilityId}
                      className="rounded-xl border border-slate-300/90 bg-white/90 p-3.5 shadow-xs transition-shadow hover:shadow-md"
                    >
                      {/* Client Header */}
                      <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Building className="size-4 shrink-0 text-slate-700" />
                            <h3 className="truncate font-sans text-sm font-bold text-slate-900">
                              {group.facilityName}
                            </h3>
                          </div>
                          {group.facilityAddress && (
                            <p className="mt-0.5 truncate text-[11px] text-slate-500">
                              {group.facilityAddress}
                            </p>
                          )}
                        </div>
                        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                          {group.totalCount} {group.totalCount === 1 ? "Dienst" : "Dienste"}
                        </Badge>
                      </div>

                      {/* Client Shifts: Frühdienst, Spätdienst, Nachtdienst */}
                      <div className="mt-3 space-y-3">
                        {/* 1. Frühdienst (F) / وردية الصباح */}
                        <div>
                          <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-bold text-blue-900">
                            <span className="flex size-4 items-center justify-center rounded bg-blue-100 text-[10px] text-blue-900 border border-blue-300">
                              F
                            </span>
                            <span>{t("morningShift")}</span>
                            <span className="text-[10px] font-normal text-slate-400">
                              ({group.morning.length})
                            </span>
                          </div>
                          {group.morning.length > 0 ? (
                            <div className="space-y-1 ps-1">
                              {group.morning.map((shift) => (
                                <ShiftEntryRow
                                  key={shift.id}
                                  shift={shift}
                                  onShiftClick={(s) => {
                                    setSelectedShift(s);
                                    setIsChangingWorker(false);
                                  }}
                                  onAssignClick={(s) => handleOpenCandidateModal(s)}
                                  assignLabel={t("assignWorker")}
                                  unassignedLabel={t("unassignedBadge")}
                                  shiftDetailsLabel={t("shiftDetails")}
                                />
                              ))}
                            </div>
                          ) : (
                            <p className="ps-5 text-[11px] italic text-slate-400">—</p>
                          )}
                        </div>

                        {/* 2. Spätdienst (S) / وردية الظهر والمساء */}
                        <div className="border-t border-slate-100 pt-2">
                          <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-bold text-amber-900">
                            <span className="flex size-4 items-center justify-center rounded bg-amber-100 text-[10px] text-amber-900 border border-amber-300">
                              S
                            </span>
                            <span>{t("lateShift")}</span>
                            <span className="text-[10px] font-normal text-slate-400">
                              ({group.late.length})
                            </span>
                          </div>
                          {group.late.length > 0 ? (
                            <div className="space-y-1 ps-1">
                              {group.late.map((shift) => (
                                <ShiftEntryRow
                                  key={shift.id}
                                  shift={shift}
                                  onShiftClick={(s) => {
                                    setSelectedShift(s);
                                    setIsChangingWorker(false);
                                  }}
                                  onAssignClick={(s) => handleOpenCandidateModal(s)}
                                  assignLabel={t("assignWorker")}
                                  unassignedLabel={t("unassignedBadge")}
                                  shiftDetailsLabel={t("shiftDetails")}
                                />
                              ))}
                            </div>
                          ) : (
                            <p className="ps-5 text-[11px] italic text-slate-400">—</p>
                          )}
                        </div>

                        {/* 3. Nachtdienst (N) / وردية الليل */}
                        <div className="border-t border-slate-100 pt-2">
                          <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-bold text-indigo-900">
                            <span className="flex size-4 items-center justify-center rounded bg-indigo-100 text-[10px] text-indigo-900 border border-indigo-300">
                              N
                            </span>
                            <span>{t("nightShift")}</span>
                            <span className="text-[10px] font-normal text-slate-400">
                              ({group.night.length})
                            </span>
                          </div>
                          {group.night.length > 0 ? (
                            <div className="space-y-1 ps-1">
                              {group.night.map((shift) => (
                                <ShiftEntryRow
                                  key={shift.id}
                                  shift={shift}
                                  onShiftClick={(s) => {
                                    setSelectedShift(s);
                                    setIsChangingWorker(false);
                                  }}
                                  onAssignClick={(s) => handleOpenCandidateModal(s)}
                                  assignLabel={t("assignWorker")}
                                  unassignedLabel={t("unassignedBadge")}
                                  shiftDetailsLabel={t("shiftDetails")}
                                />
                              ))}
                            </div>
                          ) : (
                            <p className="ps-5 text-[11px] italic text-slate-400">—</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Available Workers Section (shown cleanly beneath clients) */}
              <div className="mt-6 rounded-xl border border-slate-300/80 bg-white/80 p-3 shadow-xs">
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1 border-b border-slate-200 pb-2">
                  <div className="flex items-center gap-1.5">
                    <User className="size-4 text-slate-700" />
                    <span className="font-sans text-xs font-bold text-slate-800">
                      {t("availableWorkersTitle")}
                    </span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {filteredAvailableWorkers.length}
                    </Badge>
                  </div>

                  {/* Filter toggle */}
                  <div className="flex items-center gap-1 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setWorkerFilter("free")}
                      className={cn(
                        "rounded px-2 py-0.5 font-semibold transition-colors",
                        workerFilter === "free"
                          ? "bg-slate-800 text-white shadow-xs"
                          : "text-slate-600 hover:bg-slate-100"
                      )}
                    >
                      {t("onlyUnassignedFilter")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setWorkerFilter("all")}
                      className={cn(
                        "rounded px-2 py-0.5 font-semibold transition-colors",
                        workerFilter === "all"
                          ? "bg-slate-800 text-white shadow-xs"
                          : "text-slate-600 hover:bg-slate-100"
                      )}
                    >
                      {t("allStaffFilter")}
                    </button>
                  </div>
                </div>

                {filteredAvailableWorkers.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-400">
                    {t("noAvailableWorkers")}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 max-h-72 overflow-y-auto pe-1">
                    {filteredAvailableWorkers.map((w) => {
                      const isFree = w.status === "free";
                      const waUrl = getWorkerWhatsAppUrl(w, data.dateStr);

                      return (
                        <div
                          key={w.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/90 bg-white p-2 text-xs transition-colors hover:bg-slate-50"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-serif font-bold text-slate-900 truncate">
                                {w.fullName}
                              </span>
                              <span className="font-mono text-[10px] text-slate-500">
                                [{w.qualification === "pflegefachkraft" ? "PFK" : w.qualification === "pflegehelfer" ? "PH" : w.qualification === "kuechenhilfe" ? "KH" : w.qualification === "hausmeister" ? "HM" : "BK"}]
                              </span>
                            </div>

                            {/* Possible Shift Badges (F / S / N) */}
                            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                              <span className="text-slate-500 font-medium">
                                {t("availableShiftsLabel")}:
                              </span>
                              {w.availLetters === "Urlaub" ? (
                                <Badge variant="outline" className="text-[10px] text-amber-700 bg-amber-50">
                                  Urlaub
                                </Badge>
                              ) : w.availLetters === "OFF" ? (
                                <Badge variant="outline" className="text-[10px] text-slate-500 bg-slate-50">
                                  OFF
                                </Badge>
                              ) : (
                                <>
                                  {w.availLetters.includes("F") && (
                                    <span className="rounded bg-blue-100 px-1 py-0.2 font-mono font-bold text-blue-900 border border-blue-300">
                                      F
                                    </span>
                                  )}
                                  {w.availLetters.includes("S") && (
                                    <span className="rounded bg-amber-100 px-1 py-0.2 font-mono font-bold text-amber-900 border border-amber-300">
                                      S
                                    </span>
                                  )}
                                  {w.availLetters.includes("N") && (
                                    <span className="rounded bg-indigo-100 px-1 py-0.2 font-mono font-bold text-indigo-900 border border-indigo-300">
                                      N
                                    </span>
                                  )}
                                  {!w.availLetters && (
                                    <span className="text-slate-400 font-sans">
                                      (Keine Angabe)
                                    </span>
                                  )}
                                </>
                              )}

                              {!isFree && w.currentShiftLabel && (
                                <span className="ms-1 text-slate-500 italic truncate max-w-[150px]">
                                  • {w.currentShiftLabel}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Actions: WhatsApp icon & Quick assign */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {waUrl && (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex size-7 items-center justify-center rounded-md bg-[#25D366] text-white shadow-xs hover:bg-[#20b858]"
                                title={t("sendWhatsApp")}
                              >
                                <MessageCircle className="size-3.5" />
                              </a>
                            )}

                            {isFree && unassignedShiftsList.length > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px] px-2 font-medium"
                                onClick={() => setWorkerToAssign(w)}
                              >
                                + {t("assignToShift")}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ─────────────────────────────────────────────────────────
                TWO VERTICAL TIMELINE COLUMNS (06:00 - 12:45 / 13:00 - 19:45)
               ───────────────────────────────────────────────────────── */
            <div className="grid grid-cols-1 divide-y divide-slate-300 md:grid-cols-2 md:divide-x md:divide-y-0 md:divide-slate-300">
              {/* LEFT COLUMN: Morning to Noon (06:00 to 12:45) */}
              <div className="divide-y divide-slate-200/90">
                {MORNING_SLOTS.map((slot) => {
                  const shifts = shiftsBySlot[slot] || [];
                  return (
                    <NotebookSlotRow
                      key={slot}
                      slot={slot}
                      shifts={shifts}
                      onShiftClick={(shift) => {
                        setSelectedShift(shift);
                        setIsChangingWorker(false);
                      }}
                      onAssignClick={(shift) => handleOpenCandidateModal(shift)}
                      onAddSlotClick={() => openAddShiftAtSlot(slot)}
                      assignLabel={t("assignWorker")}
                      unassignedLabel={t("unassignedBadge")}
                    />
                  );
                })}
              </div>

              {/* RIGHT COLUMN: Afternoon to Evening (13:00 to 19:45) + AVAILABLE WORKERS BOX */}
              <div className="flex flex-col justify-between divide-y divide-slate-200/90 md:ps-2">
                <div className="divide-y divide-slate-200/90">
                  {AFTERNOON_SLOTS.map((slot) => {
                    const shifts = shiftsBySlot[slot] || [];
                    return (
                      <NotebookSlotRow
                        key={slot}
                        slot={slot}
                        shifts={shifts}
                        onShiftClick={(shift) => {
                          setSelectedShift(shift);
                          setIsChangingWorker(false);
                        }}
                        onAssignClick={(shift) => handleOpenCandidateModal(shift)}
                        onAddSlotClick={() => openAddShiftAtSlot(slot)}
                        assignLabel={t("assignWorker")}
                        unassignedLabel={t("unassignedBadge")}
                      />
                    );
                  })}
                </div>

                {/* AVAILABLE WORKERS SECTION (Verfügbare Mitarbeiter) */}
                <div className="mt-4 rounded-xl border border-slate-300/80 bg-white/80 p-3 shadow-xs">
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1 border-b border-slate-200 pb-2">
                    <div className="flex items-center gap-1.5">
                      <User className="size-4 text-slate-700" />
                      <span className="font-sans text-xs font-bold text-slate-800">
                        {t("availableWorkersTitle")}
                      </span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {filteredAvailableWorkers.length}
                      </Badge>
                    </div>

                    {/* Filter toggle */}
                    <div className="flex items-center gap-1 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setWorkerFilter("free")}
                        className={cn(
                          "rounded px-2 py-0.5 font-semibold transition-colors",
                          workerFilter === "free"
                            ? "bg-slate-800 text-white shadow-xs"
                            : "text-slate-600 hover:bg-slate-100"
                        )}
                      >
                        {t("onlyUnassignedFilter")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setWorkerFilter("all")}
                        className={cn(
                          "rounded px-2 py-0.5 font-semibold transition-colors",
                          workerFilter === "all"
                            ? "bg-slate-800 text-white shadow-xs"
                            : "text-slate-600 hover:bg-slate-100"
                        )}
                      >
                        {t("allStaffFilter")}
                      </button>
                    </div>
                  </div>

                  {filteredAvailableWorkers.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-400">
                      {t("noAvailableWorkers")}
                    </p>
                  ) : (
                    <div className="max-h-72 space-y-1.5 overflow-y-auto pe-1">
                      {filteredAvailableWorkers.map((w) => {
                        const isFree = w.status === "free";
                        const waUrl = getWorkerWhatsAppUrl(w, data.dateStr);

                        return (
                          <div
                            key={w.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/90 bg-white p-2 text-xs transition-colors hover:bg-slate-50"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-serif font-bold text-slate-900 truncate">
                                  {w.fullName}
                                </span>
                                <span className="font-mono text-[10px] text-slate-500">
                                  [{w.qualification === "pflegefachkraft" ? "PFK" : w.qualification === "pflegehelfer" ? "PH" : w.qualification === "kuechenhilfe" ? "KH" : w.qualification === "hausmeister" ? "HM" : "BK"}]
                                </span>
                              </div>

                              {/* Possible Shift Badges (F / S / N) */}
                              <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                                <span className="text-slate-500 font-medium">
                                  {t("availableShiftsLabel")}:
                                </span>
                                {w.availLetters === "Urlaub" ? (
                                  <Badge variant="outline" className="text-[10px] text-amber-700 bg-amber-50">
                                    Urlaub
                                  </Badge>
                                ) : w.availLetters === "OFF" ? (
                                  <Badge variant="outline" className="text-[10px] text-slate-500 bg-slate-50">
                                    OFF
                                  </Badge>
                                ) : (
                                <>
                                  {w.availLetters.includes("F") && (
                                    <span className="rounded bg-blue-100 px-1 py-0.2 font-mono font-bold text-blue-900 border border-blue-300">
                                      F
                                    </span>
                                  )}
                                  {w.availLetters.includes("S") && (
                                    <span className="rounded bg-amber-100 px-1 py-0.2 font-mono font-bold text-amber-900 border border-amber-300">
                                      S
                                    </span>
                                  )}
                                  {w.availLetters.includes("N") && (
                                    <span className="rounded bg-indigo-100 px-1 py-0.2 font-mono font-bold text-indigo-900 border border-indigo-300">
                                      N
                                    </span>
                                  )}
                                  {!w.availLetters && (
                                    <span className="text-slate-400 font-sans">
                                      (Keine Angabe)
                                    </span>
                                  )}
                                </>
                              )}

                              {!isFree && w.currentShiftLabel && (
                                <span className="ms-1 text-slate-500 italic truncate max-w-[150px]">
                                  • {w.currentShiftLabel}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Actions: WhatsApp icon & Quick assign */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {waUrl && (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex size-7 items-center justify-center rounded-md bg-[#25D366] text-white shadow-xs hover:bg-[#20b858]"
                                title={t("sendWhatsApp")}
                              >
                                <MessageCircle className="size-3.5" />
                              </a>
                            )}

                            {isFree && unassignedShiftsList.length > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px] px-2 font-medium"
                                onClick={() => setWorkerToAssign(w)}
                              >
                                + {t("assignToShift")}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          )}

          {/* ─────────────────────────────────────────────────────────
              NIGHT & LATE SHIFTS (Only displayed in Time/Timeline mode)
             ───────────────────────────────────────────────────────── */}
          {sortMode === "time" && nightShifts.length > 0 && (
            <div className="mt-4 border-t-2 border-slate-700/80 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-700">
                  {t("nightShiftsSection")} (20:00 – 06:00)
                </span>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {nightShifts.length}
                </Badge>
              </div>
              <div className="divide-y divide-slate-200/90 rounded border border-slate-200 bg-white/70">
                {nightShifts.map((shift) => (
                  <div
                    key={shift.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-2 hover:bg-slate-50/80"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-500">
                        {shift.startTime}
                      </span>
                      {shift.isUnassigned ? (
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-amber-100 px-1 font-mono text-[11px] font-bold text-amber-900 border border-amber-300">
                            {shift.shiftLetter}
                          </span>
                          <span className="font-medium text-amber-900">
                            [{t("unassigned")}] {eq(shift.requiredQualification)}
                          </span>
                          <span className="font-serif italic text-slate-800">
                            {shift.facilityName}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-blue-900">
                          <span className="text-blue-700 font-bold">✓</span>
                          <span className="font-mono text-[11px] font-bold text-blue-900">
                            {shift.shiftLetter}
                          </span>
                          <span className="font-serif font-bold text-blue-950">
                            {shift.workerName}
                          </span>
                          {shift.workerQualification && (
                            <span className="text-xs text-blue-700">
                              [{shift.workerQualification.slice(0, 3).toUpperCase()}]
                            </span>
                          )}
                          <span className="font-serif italic text-slate-800">
                            {shift.facilityName}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">
                        {shift.startTime}–{shift.endTime}
                      </span>
                      {shift.isUnassigned ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px] font-medium"
                          onClick={() => handleOpenCandidateModal(shift)}
                        >
                          + {t("assignWorker")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px]"
                          onClick={() => {
                            setSelectedShift(shift);
                            setIsChangingWorker(false);
                          }}
                        >
                          {t("shiftDetails")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────
              BOTTOM OF NOTEBOOK:
              Date Stamp + 3 Mini Calendars + Notes Area (with Pencil Icon)
             ───────────────────────────────────────────────────────── */}
          <div className="mt-6 border-t-2 border-slate-700/80 pt-4">
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
              {/* Date Stamp (e.g. "20. 7.") */}
              <div className="lg:col-span-1">
                <span className="font-serif text-sm font-black text-slate-700">
                  {data.day}. {data.month}.
                </span>
              </div>

              {/* 3 Mini Monthly Calendars */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:col-span-7">
                {data.miniCalendars.map((miniMonth) => (
                  <MiniCalendarCard
                    key={`${miniMonth.year}-${miniMonth.month}`}
                    miniMonth={miniMonth}
                    selectedDateStr={data.dateStr}
                    qualificationFilter={qualificationFilter}
                  />
                ))}
              </div>

              {/* Notes & Memos Area (with Pencil Icon) */}
              <div className="relative rounded-lg border border-slate-300/80 bg-white/60 p-2.5 lg:col-span-4 print:border-stone-400">
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <PenTool className="size-3.5 text-slate-600" />
                    <span>{t("notesTitle")}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[10px] no-print"
                    disabled={isSavingNote}
                    onClick={handleSaveNote}
                  >
                    <Save className="size-3 me-1" />
                    {t("saveNotes")}
                  </Button>
                </div>
                <Textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder={t("notesPlaceholder")}
                  rows={4}
                  className="min-h-16 resize-none border-none bg-transparent p-1 font-serif text-xs text-slate-800 placeholder:text-slate-400 focus-visible:ring-0"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          DIALOG 1: ASSIGN WORKER TO UNASSIGNED SHIFT
         ───────────────────────────────────────────────────────────── */}
      <Dialog
        open={assigningShift !== null}
        onOpenChange={(open) => !open && setAssigningShift(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs font-bold text-amber-900 border border-amber-300">
                {assigningShift?.shiftLetter}
              </span>
              <span>{t("assignWorker")}</span>
            </DialogTitle>
            <DialogDescription>
              {assigningShift?.facilityName} · {assigningShift?.startTime}–{assigningShift?.endTime}
              {assigningShift?.ward ? ` · ${assigningShift.ward}` : ""}
              {" · "}
              {assigningShift?.requiredQualification && eq(assigningShift.requiredQualification)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={candidateSearch}
                onChange={(e) => setCandidateSearch(e.target.value)}
                placeholder={tm("searchWorker")}
                className="h-8 ps-8 text-xs"
              />
            </div>

            {loadingCandidates ? (
              <p className="py-4 text-center text-xs text-muted-foreground">{tm("candAvailable")}...</p>
            ) : filteredCandidates.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">{tm("noCandidates")}</p>
            ) : (
              <div className="max-h-60 space-y-1.5 overflow-y-auto">
                {filteredCandidates.map((cand) => {
                  const badge = candidateStatusBadge[cand.status];
                  const isBusy = cand.status === "busy";
                  return (
                    <div
                      key={cand.workerId}
                      className="flex items-center justify-between gap-2 rounded-lg border p-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground truncate">{cand.fullName}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Badge className={cn("text-[10px] px-1 py-0", badge.cls)}>
                            {badge.label}
                          </Badge>
                          {cand.conflictTimes.length > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {cand.conflictTimes.join(", ")}
                            </span>
                          )}
                        </div>
                      </div>

                      {(() => {
                        const needsOverride = cand.status !== "available";
                        return (
                          <Button
                            size="sm"
                            variant={needsOverride ? "outline" : "default"}
                            className={cn(
                              "h-7 shrink-0 text-xs gap-1",
                              needsOverride && "border-amber-400 text-amber-800 hover:bg-amber-50"
                            )}
                            disabled={assigningWorkerId === cand.workerId}
                            onClick={() => handleAssignWorker(cand.workerId, needsOverride)}
                          >
                            {needsOverride && <AlertCircle className="size-3 text-amber-600" />}
                            {needsOverride ? tm("forceAssign") : tm("assign")}
                          </Button>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────
          DIALOG 2: SHIFT DETAILS (ASSIGNED SHIFT)
          Includes:
          - WhatsApp button with WhatsApp icon
          - Accept on behalf of worker immediately
          - Replace / swap worker
         ───────────────────────────────────────────────────────────── */}
      <Dialog
        open={selectedShift !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedShift(null);
            setIsChangingWorker(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-blue-800">
                {selectedShift?.shiftLetter}
              </span>
              <span>{t("shiftDetails")}</span>
            </DialogTitle>
            <DialogDescription>
              {selectedShift?.startTime}–{selectedShift?.endTime} ({selectedShift?.breakMinutes} {t("breakTime")})
            </DialogDescription>
          </DialogHeader>

          {selectedShift && (
            <div className="space-y-3 py-2 text-xs">
              <div className="rounded-lg border bg-muted/30 p-2.5 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("facility")}:</span>
                  <span className="font-semibold text-foreground text-end">{selectedShift.facilityName}</span>
                </div>
                {selectedShift.facilityAddress && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Adresse:</span>
                    <span className="text-foreground text-end">{selectedShift.facilityAddress}</span>
                  </div>
                )}
                {selectedShift.ward && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t("stationWard")}:</span>
                    <span className="font-semibold text-foreground">{selectedShift.ward}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("worker")}:</span>
                  <span className="font-semibold text-blue-900 dark:text-blue-400">
                    {selectedShift.workerName}
                  </span>
                </div>
                {selectedShift.workerPhone && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Telefon:</span>
                    <div className="flex items-center gap-2">
                      <a href={`tel:${selectedShift.workerPhone}`} className="text-primary hover:underline">
                        {selectedShift.workerPhone}
                      </a>
                      {/* WhatsApp Button next to phone number */}
                      <a
                        href={getShiftWhatsAppUrl(selectedShift, data.dateStr)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded bg-[#25D366] px-2 py-0.5 text-[11px] font-semibold text-white shadow-xs hover:bg-[#20b858]"
                        title={t("sendWhatsApp")}
                      >
                        <MessageCircle className="size-3.5" />
                        <span>WhatsApp</span>
                      </a>
                    </div>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Status:</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {selectedShift.clientConfirmed
                        ? t("statusSigned")
                        : selectedShift.status === "confirmed"
                        ? t("statusAccepted")
                        : t("statusPending")}
                    </Badge>

                    {/* Accept on behalf of worker immediately if pending */}
                    {!selectedShift.clientConfirmed && selectedShift.status === "pending" && (
                      <Button
                        size="sm"
                        className="h-6 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] gap-1 px-2"
                        disabled={isAcceptingOnBehalf}
                        onClick={handleAcceptOnBehalf}
                      >
                        <CheckCircle2 className="size-3" />
                        {t("acceptOnBehalf")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {selectedShift.cancelRequested && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-amber-900">
                  <div className="font-semibold">{tm("releaseShift")} (Stornierungsanfrage)</div>
                  {selectedShift.cancelNote && (
                    <div className="text-[11px] mt-0.5">{selectedShift.cancelNote}</div>
                  )}
                </div>
              )}

              {/* ─────────────────────────────────────────────────────
                  CHANGE / SWAP WORKER MODE
                 ───────────────────────────────────────────────────── */}
              {isChangingWorker && (
                <div className="rounded-lg border border-primary/40 bg-card p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-foreground">
                      {t("selectNewWorker")}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[10px]"
                      onClick={() => setIsChangingWorker(false)}
                    >
                      Abbrechen
                    </Button>
                  </div>

                  {loadingChangeCandidates ? (
                    <p className="py-2 text-center text-xs text-muted-foreground">
                      {tm("candAvailable")}...
                    </p>
                  ) : !changeCandidates || changeCandidates.length === 0 ? (
                    <p className="py-2 text-center text-xs text-muted-foreground">
                      {tm("noCandidates")}
                    </p>
                  ) : (
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                      {changeCandidates.map((cand) => {
                        const badge = candidateStatusBadge[cand.status];
                        const needsOverride = cand.status !== "available";
                        return (
                          <div
                            key={cand.workerId}
                            className="flex items-center justify-between gap-2 rounded border p-1.5 text-xs"
                          >
                            <div className="min-w-0">
                              <span className="font-medium truncate block">{cand.fullName}</span>
                              <Badge className={cn("text-[9px] px-1 py-0", badge.cls)}>
                                {badge.label}
                              </Badge>
                            </div>
                            <Button
                              size="sm"
                              variant={needsOverride ? "outline" : "default"}
                              className={cn(
                                "h-6 text-[10px] px-2 gap-1",
                                needsOverride && "border-amber-400 text-amber-800 hover:bg-amber-50"
                              )}
                              disabled={replacingWorkerId === cand.workerId}
                              onClick={() => handleReplaceWorker(cand.workerId, needsOverride)}
                            >
                              {needsOverride && <AlertCircle className="size-3 text-amber-600 me-0.5" />}
                              {needsOverride ? tm("forceAssign") : tm("assign")}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2 justify-between">
            <div className="flex items-center gap-1.5">
              {/* WhatsApp Button */}
              {selectedShift?.workerPhone && (
                <a
                  href={getShiftWhatsAppUrl(selectedShift, data.dateStr)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#20b858]"
                >
                  <MessageCircle className="size-4" />
                  <span>{t("sendWhatsApp")}</span>
                </a>
              )}

              {/* Swap Worker Button */}
              {selectedShift?.assignmentId && !selectedShift.clientConfirmed && !isChangingWorker && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={openChangeWorkerMode}
                >
                  <RefreshCw className="size-3.5" />
                  {t("changeWorker")}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {selectedShift?.assignmentId && !selectedShift.clientConfirmed && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs text-amber-700 hover:text-amber-800"
                  onClick={() => handleUnassign(selectedShift.assignmentId!)}
                >
                  <UserMinus className="size-3.5" />
                  {t("unassignWorker")}
                </Button>
              )}
              {selectedShift?.assignmentId && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => handleDeleteShift(selectedShift.assignmentId!)}
                >
                  <Trash2 className="size-3.5" />
                  {t("deleteShift")}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────
          DIALOG 3: ASSIGN AVAILABLE WORKER TO AN OPEN SHIFT
         ───────────────────────────────────────────────────────────── */}
      <Dialog
        open={workerToAssign !== null}
        onOpenChange={(open) => !open && setWorkerToAssign(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="size-4" />
              <span>
                {t("assignToShift")}: {workerToAssign?.fullName}
              </span>
            </DialogTitle>
            <DialogDescription>
              Wählen Sie den offenen Dienst, dem dieser Mitarbeiter zugewiesen werden soll.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            {unassignedShiftsList.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("noShiftsForDay")}</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {unassignedShiftsList.map((shift) => (
                  <div
                    key={shift.id}
                    className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-foreground">
                        {shift.facilityName}
                        {shift.ward ? ` (${shift.ward})` : ""}
                      </div>
                      <div className="text-muted-foreground">
                        {shift.startTime}–{shift.endTime} · {eq(shift.requiredQualification)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      disabled={assigningWorkerId === workerToAssign?.id}
                      onClick={() =>
                        workerToAssign &&
                        handleAssignWorkerToOpenShift(workerToAssign.id, shift.orderId)
                      }
                    >
                      {tm("assign")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────
          DIALOG 4: ADD NEW SHIFT / OPEN ORDER
         ───────────────────────────────────────────────────────────── */}
      <Dialog open={isAddingShift} onOpenChange={setIsAddingShift}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="size-4" />
              <span>
                {t("addShift")} ({newShiftSlot})
              </span>
            </DialogTitle>
            <DialogDescription>
              {t("quickAddSlot", { time: newShiftSlot })} · {data.dateStr}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div>
              <label className="mb-1 block font-medium text-foreground">{t("facility")}</label>
              <SearchableSelect
                value={newShiftClientId}
                onChange={setNewShiftClientId}
                options={facilityOptions}
                placeholder={tm("selectFacility")}
                searchPlaceholder={tm("searchFacility")}
                emptyText={tm("noFacilityMatch")}
                className="w-full text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-medium text-foreground">{tm("timeFrom")}</label>
                <Input
                  type="time"
                  value={newShiftStartTime}
                  onChange={(e) => setNewShiftStartTime(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div>
                <label className="mb-1 block font-medium text-foreground">{tm("timeTo")}</label>
                <Input
                  type="time"
                  value={newShiftEndTime}
                  onChange={(e) => setNewShiftEndTime(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-medium text-foreground">
                  {t("breakTime")} (Min.)
                </label>
                <Input
                  type="number"
                  min="0"
                  max="120"
                  step="15"
                  value={newShiftBreak}
                  onChange={(e) => setNewShiftBreak(Number(e.target.value) || 0)}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block font-medium text-foreground">{tm("quantity")}</label>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={newShiftQuantity}
                  onChange={(e) => setNewShiftQuantity(Number(e.target.value) || 1)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block font-medium text-foreground">{oq("qualification")}</label>
              <select
                value={newShiftQual}
                onChange={(e) => setNewShiftQual(e.target.value as Qualification)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                {qualifications.map((q) => (
                  <option key={q} value={q}>
                    {eq(q)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block font-medium text-foreground">{t("stationWard")}</label>
              <Input
                value={newShiftWard}
                onChange={(e) => setNewShiftWard(e.target.value)}
                placeholder="z. B. Station 2, EG"
                className="h-8 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsAddingShift(false)}>
              Abbrechen
            </Button>
            <Button size="sm" onClick={handleCreateNewShift}>
              {tm("createOrder")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// COMPONENT: A SINGLE TIME SLOT ROW (Ruled line with authentic pen handwriting)
// ───────────────────────────────────────────────────────────────────
function NotebookSlotRow({
  slot,
  shifts,
  onShiftClick,
  onAssignClick,
  onAddSlotClick,
  assignLabel,
  unassignedLabel,
}: {
  slot: string;
  shifts: DailyNotebookShift[];
  onShiftClick: (shift: DailyNotebookShift) => void;
  onAssignClick: (shift: DailyNotebookShift) => void;
  onAddSlotClick: () => void;
  assignLabel: string;
  unassignedLabel: string;
}) {
  const hasShifts = shifts.length > 0;

  return (
    <div className="group relative flex min-h-[30px] items-center border-b border-slate-200/90 py-0.5 transition-colors hover:bg-sky-50/40">
      {/* Time Label (e.g. 6.00, 6.15, 6.30) */}
      <div className="w-12 shrink-0 ps-1 font-mono text-[11px] font-semibold text-slate-500">
        {slot.replace(":", ".")}
      </div>

      {/* Row Contents: Assigned shifts or Unassigned shifts or blank line */}
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5 pe-1">
        {hasShifts ? (
          shifts.map((shift) => (
            <div
              key={shift.id}
              className="flex items-center gap-1.5 transition-transform hover:scale-[1.01]"
            >
              {shift.isUnassigned ? (
                /* Unassigned / Open Shift Card */
                <button
                  type="button"
                  onClick={() => onAssignClick(shift)}
                  className="flex items-center gap-1.5 rounded-sm border border-dashed border-amber-400 bg-amber-50/80 px-1.5 py-0.5 text-start transition-colors hover:bg-amber-100"
                >
                  <span className="font-mono text-[11px] font-bold text-amber-800">
                    {shift.shiftLetter}
                  </span>
                  <span className="font-serif text-xs font-semibold text-amber-900">
                    [{unassignedLabel}]
                  </span>
                  <span className="font-serif text-xs text-slate-800">
                    {shift.facilityName}
                  </span>
                  <span className="rounded bg-amber-200/80 px-1 py-0.2 text-[10px] font-medium text-amber-900">
                    + {assignLabel}
                  </span>
                </button>
              ) : (
                /* Assigned Shift: Blue Ballpoint Ink Aesthetic */
                <button
                  type="button"
                  onClick={() => onShiftClick(shift)}
                  className="group/entry flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-start transition-colors hover:bg-blue-50/90"
                >
                  {/* Blue Pen Checkmark */}
                  <span className="text-[12px] font-bold text-blue-700">✓</span>

                  {/* Shift Letter (F, S, N) */}
                  <span className="font-mono text-xs font-bold text-blue-900">
                    {shift.shiftLetter}
                  </span>

                  {/* Worker Name (Handwriting look) */}
                  <span className="font-serif text-xs font-bold tracking-tight text-blue-950 underline-offset-2 group-hover/entry:underline">
                    {shift.workerName}
                  </span>

                  {/* Qualification Tag */}
                  {shift.workerQualification && (
                    <span className="font-mono text-[10px] text-blue-800">
                      [{shift.workerQualification === "pflegefachkraft" ? "PFK" : shift.workerQualification === "pflegehelfer" ? "PH" : shift.workerQualification === "kuechenhilfe" ? "KH" : shift.workerQualification === "hausmeister" ? "HM" : "BK"}]
                    </span>
                  )}

                  {/* Facility Name */}
                  <span className="font-serif text-xs text-slate-700">
                    {shift.facilityName}
                    {shift.ward ? ` (${shift.ward})` : ""}
                  </span>

                  {/* Signed marker */}
                  {shift.clientConfirmed && (
                    <span className="size-2 rounded-full bg-emerald-600 inline-block" />
                  )}
                </button>
              )}
            </div>
          ))
        ) : (
          /* Empty Ruled Line: Quick Add Button on Hover */
          <button
            type="button"
            onClick={onAddSlotClick}
            className="flex size-5 items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-800 group-hover:opacity-100 no-print"
            title="Dienst für diesen Zeitpunkt eintragen"
          >
            <Plus className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// COMPONENT: MINI CALENDAR CARD (Bottom month grid with week numbers)
// ───────────────────────────────────────────────────────────────────
function MiniCalendarCard({
  miniMonth,
  selectedDateStr,
  qualificationFilter,
}: {
  miniMonth: {
    year: number;
    month: number;
    monthName: string;
    weeks: { weekNum: number; days: (MiniCalendarDay | null)[] }[];
  };
  selectedDateStr: string;
  qualificationFilter: string;
}) {
  return (
    <div className="rounded border border-slate-300/80 bg-white/70 p-1.5 font-mono text-[10px]">
      {/* Month Header: Number & Year */}
      <div className="mb-1 flex items-center justify-between font-bold text-slate-700">
        <span>{miniMonth.month}</span>
        <span>{miniMonth.year}</span>
      </div>

      {/* Weekday Header: Wo M D M D F S S */}
      <div className="grid grid-cols-8 text-center font-semibold text-slate-500">
        <span className="text-slate-400">Wo</span>
        <span>M</span>
        <span>D</span>
        <span>M</span>
        <span>D</span>
        <span>F</span>
        <span>S</span>
        <span className="text-rose-600">S</span>
      </div>

      {/* Weeks & Days */}
      <div className="divide-y divide-slate-100">
        {miniMonth.weeks.map((week) => (
          <div key={week.weekNum} className="grid grid-cols-8 items-center py-0.5 text-center">
            {/* Week Number */}
            <span className="text-slate-400 text-[9px]">{week.weekNum}</span>

            {/* 7 Days (Mon-Sun) */}
            {week.days.map((d, dIdx) => {
              if (!d) {
                return <span key={dIdx} className="text-transparent">·</span>;
              }
              const isSunday = dIdx === 6;
              const isSelected = d.dateStr === selectedDateStr;

              return (
                <Link
                  key={d.day}
                  href={`/admin/schedule/book?date=${d.dateStr}${
                    qualificationFilter !== "all" ? `&qualification=${qualificationFilter}` : ""
                  }`}
                  className={cn(
                    "flex size-4 items-center justify-center rounded-sm transition-colors mx-auto",
                    isSelected
                      ? "bg-blue-900 font-bold text-white shadow-xs"
                      : isSunday
                      ? "text-rose-600 hover:bg-slate-200"
                      : "text-slate-700 hover:bg-slate-200"
                  )}
                >
                  {d.day}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// COMPONENT: SHIFT ENTRY ROW (Used in Client-grouped view)
// ───────────────────────────────────────────────────────────────────
function ShiftEntryRow({
  shift,
  onShiftClick,
  onAssignClick,
  assignLabel,
  unassignedLabel,
  shiftDetailsLabel,
}: {
  shift: DailyNotebookShift;
  onShiftClick: (shift: DailyNotebookShift) => void;
  onAssignClick: (shift: DailyNotebookShift) => void;
  assignLabel: string;
  unassignedLabel: string;
  shiftDetailsLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200/80 bg-slate-50/50 p-1.5 transition-colors hover:bg-blue-50/60">
      <div className="min-w-0 flex-1">
        {shift.isUnassigned ? (
          <button
            type="button"
            onClick={() => onAssignClick(shift)}
            className="flex flex-wrap items-center gap-1.5 text-start"
          >
            <span className="font-mono text-xs font-bold text-slate-600">
              {shift.startTime}–{shift.endTime}
            </span>
            <span className="rounded bg-amber-100 px-1 py-0.2 font-mono text-[10px] font-bold text-amber-900 border border-amber-300">
              {shift.shiftLetter}
            </span>
            <span className="font-serif text-xs font-semibold text-amber-900">
              [{unassignedLabel}]
            </span>
            {shift.ward && (
              <span className="text-[11px] text-slate-500">
                ({shift.ward})
              </span>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onShiftClick(shift)}
            className="flex flex-wrap items-center gap-1.5 text-start"
          >
            <span className="text-[11px] font-bold text-blue-700">✓</span>
            <span className="font-mono text-xs font-semibold text-slate-600">
              {shift.startTime}–{shift.endTime}
            </span>
            <span className="font-mono text-[11px] font-bold text-blue-900">
              {shift.shiftLetter}
            </span>
            <span className="font-serif text-xs font-bold text-blue-950 underline-offset-2 hover:underline">
              {shift.workerName}
            </span>
            {shift.workerQualification && (
              <span className="font-mono text-[10px] text-blue-800">
                [{shift.workerQualification === "pflegefachkraft" ? "PFK" : shift.workerQualification === "pflegehelfer" ? "PH" : shift.workerQualification === "kuechenhilfe" ? "KH" : shift.workerQualification === "hausmeister" ? "HM" : "BK"}]
              </span>
            )}
            {shift.ward && (
              <span className="text-[11px] text-slate-500">
                ({shift.ward})
              </span>
            )}
            {shift.clientConfirmed && (
              <span className="size-2 rounded-full bg-emerald-600 inline-block" title="Bestätigt" />
            )}
          </button>
        )}
      </div>

      <div className="shrink-0">
        {shift.isUnassigned ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px] font-semibold text-amber-900 border-amber-300 hover:bg-amber-100"
            onClick={() => onAssignClick(shift)}
          >
            + {assignLabel}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px] text-slate-600"
            onClick={() => onShiftClick(shift)}
          >
            {shiftDetailsLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

