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
import { CalendarDays, CheckCircle, XCircle } from "lucide-react";
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

  // Basic structure, since we are doing Server Action for actual data if needed,
  // or we can just fetch it when opening. To keep it simple, we will fetch it via a server action or API route.
  // Actually, we can fetch it when the modal opens using a server action.
  const [leaveData, setLeaveData] = useState<LeaveData | null>(null);
  const [hours, setHours] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && !leaveData) {
      // Fetch leave request details
      fetch(`/api/leave/${leaveRequestId}`)
        .then((res) => res.json())
        .then((data) => {
          setLeaveData(data);
          const initialHours: Record<string, string> = {};
          data.days.forEach((d: NonNullable<LeaveData>["days"][0]) => {
            initialHours[d.id] = String(d.hours ?? 7);
          });
          setHours(initialHours);
        })
        .catch((e) => console.error(e));
    }
  }, [open, leaveRequestId, leaveData]);

  function handleAction(status: "approved" | "rejected") {
    startTransition(async () => {
      if (!leaveData) return;
      
      const decisions = leaveData.days.map((d: NonNullable<LeaveData>["days"][0]) => {
        return {
          date: d.date.split("T")[0],
          status,
          hours: Number(hours[d.id]) || 7,
        };
      });
      
      const res = await reviewLeaveRequest(leaveRequestId, decisions);
      if (res.ok) {
        toast.success(status === "approved" ? "Genehmigt" : "Abgelehnt");
        setOpen(false);
        router.refresh();
      } else {
        toast.error("Fehler");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" className="gap-2">
            <CalendarDays className="size-4" />
            {t("previewLeave") || "Urlaubsantrag prüfen"}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("previewLeave") || "Urlaubsantrag prüfen"}</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          {!leaveData ? (
            <p className="text-sm text-muted-foreground">{c("loading")}</p>
          ) : (
            <>
              <p className="text-sm font-medium">
                {leaveData.worker.fullName} hat Urlaub für folgende Tage beantragt:
              </p>
              <div className="space-y-3">
                {leaveData.days.map((d: NonNullable<LeaveData>["days"][0]) => (
                  <div key={d.id} className="flex items-center justify-between gap-4 p-2 border rounded">
                    <span className="text-sm font-medium">{d.date.split("T")[0]}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Std:</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={hours[d.id] || "7"}
                        onChange={(e) => setHours({ ...hours, [d.id]: e.target.value })}
                        className="w-16 rounded border px-2 py-1 text-sm outline-none focus:border-ring focus:ring-1"
                        disabled={d.status !== "pending"}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          {leaveData && leaveData.status === "pending" && (
            <>
              <Button
                variant="destructive"
                onClick={() => handleAction("rejected")}
                disabled={pending}
                className="gap-2"
              >
                <XCircle className="size-4" />
                Ablehnen
              </Button>
              <Button
                onClick={() => handleAction("approved")}
                disabled={pending}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700"
              >
                <CheckCircle className="size-4" />
                Genehmigen
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
