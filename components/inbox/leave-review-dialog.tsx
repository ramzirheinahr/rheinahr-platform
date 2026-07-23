"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CalendarDays, CheckCircle, Save, Trash2, Plus } from "lucide-react";
import { reviewLeaveRequest } from "@/app/[locale]/admin/leave/actions";

type LeaveData = {
  id: string;
  status: "pending" | "approved" | "rejected";
  worker: { fullName: string };
  days: {
    id: string;
    date: string;
    hours: number | null;
    status: "pending" | "approved" | "rejected";
  }[];
};

type LocalDay = {
  id: string;
  date: string;
  hours: number;
  status: "pending" | "approved" | "rejected";
};

export function LeaveReviewDialog({
  leaveRequestId,
}: {
  leaveRequestId: string;
}) {
  const t = useTranslations("availability"); // Re-use translations
  const c = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [leaveData, setLeaveData] = useState<LeaveData | null>(null);
  const [localDays, setLocalDays] = useState<LocalDay[]>([]);
  const [newDate, setNewDate] = useState("");

  useEffect(() => {
    if (open && !leaveData) {
      fetch(`/api/leave/${leaveRequestId}`)
        .then((res) => res.json())
        .then((data) => {
          setLeaveData(data);
          const days: LocalDay[] = data.days.map((d: any) => ({
            id: d.id,
            date: d.date.split("T")[0],
            hours: Number(d.hours) || 7,
            status: d.status,
          }));
          setLocalDays(days.sort((a, b) => a.date.localeCompare(b.date)));
        })
        .catch((e) => console.error(e));
    }
  }, [open, leaveRequestId, leaveData]);

  function handleAddDay() {
    if (!newDate) return;
    if (localDays.find((d) => d.date === newDate)) {
      toast.error("Datum existiert bereits");
      return;
    }
    const newDay: LocalDay = {
      id: `temp-${Date.now()}`,
      date: newDate,
      hours: 7,
      status: "approved", // default to approved if added manually by admin
    };
    setLocalDays([...localDays, newDay].sort((a, b) => a.date.localeCompare(b.date)));
    setNewDate("");
  }

  function handleRemoveDay(id: string) {
    setLocalDays(localDays.filter((d) => d.id !== id));
  }

  function handleUpdateDay(id: string, field: keyof LocalDay, value: any) {
    setLocalDays(
      localDays.map((d) => (d.id === id ? { ...d, [field]: value } : d))
    );
  }

  function handleSave() {
    startTransition(async () => {
      const decisions = localDays.map((d) => ({
        date: d.date,
        status: d.status,
        hours: d.hours,
      }));
      
      const res = await reviewLeaveRequest(leaveRequestId, decisions as any);
      if (res.ok) {
        toast.success(c("saved"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error("Fehler beim Speichern");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(val) => {
      setOpen(val);
      if (!val) {
        // Reset when closing
        setLeaveData(null);
        setLocalDays([]);
      }
    }}>
      <DialogTrigger
        render={
          <Button variant="outline" className="gap-2">
            <CalendarDays className="size-4" />
            Urlaubsantrag bearbeiten
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Urlaubsantrag bearbeiten</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-6 max-h-[60vh] overflow-y-auto pr-2">
          {!leaveData ? (
            <p className="text-sm text-muted-foreground">{c("loading")}</p>
          ) : (
            <>
              <p className="text-sm font-medium">
                {leaveData.worker.fullName} hat Urlaub beantragt. Sie können einzelne Tage anpassen:
              </p>
              <div className="space-y-3">
                {localDays.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Keine Tage vorhanden.</p>
                ) : null}
                {localDays.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 p-3 border rounded bg-muted/20">
                    <span className="text-sm font-medium w-24 whitespace-nowrap">{d.date}</span>
                    <div className="flex-1 flex items-center gap-3">
                      <select
                        className="rounded border px-2 py-1 text-sm outline-none w-32"
                        value={d.status}
                        onChange={(e) => handleUpdateDay(d.id, "status", e.target.value)}
                      >
                        <option value="pending">Ausstehend</option>
                        <option value="approved">Genehmigt</option>
                        <option value="rejected">Abgelehnt</option>
                      </select>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Std:</span>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={d.hours}
                          onChange={(e) => handleUpdateDay(d.id, "hours", Number(e.target.value) || 0)}
                          className="w-16 rounded border px-2 py-1 text-sm outline-none"
                        />
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-600"
                      onClick={() => handleRemoveDay(d.id)}
                      title="Tag entfernen"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="border-t pt-4">
                <p className="text-sm font-medium mb-2">Weiteren Tag hinzufügen</p>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    className="flex-1 rounded border px-3 py-1.5 text-sm outline-none"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                  />
                  <Button variant="outline" size="sm" onClick={handleAddDay} disabled={!newDate}>
                    <Plus className="size-4 mr-1" />
                    Hinzufügen
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          {leaveData && (
            <Button
              onClick={handleSave}
              disabled={pending}
              className="gap-2"
            >
              <Save className="size-4" />
              {c("save")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
