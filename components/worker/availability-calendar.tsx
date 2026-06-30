"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { setAvailability } from "@/app/[locale]/worker/availability/actions";

export type DayCell = {
  day: number | null;
  dateStr: string | null;
  status: "available" | "unavailable" | "assigned";
  isToday: boolean;
};

export function AvailabilityCalendar({
  weeks,
  weekdays,
  monthLabel,
  prevHref,
  nextHref,
}: {
  weeks: DayCell[][];
  weekdays: string[];
  monthLabel: string;
  prevHref: string;
  nextHref: string;
}) {
  const t = useTranslations("availability");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle(cell: DayCell) {
    if (!cell.dateStr || cell.status === "assigned" || pending) return;
    const makeAvailable = cell.status === "unavailable";
    startTransition(async () => {
      const res = await setAvailability(cell.dateStr!, makeAvailable);
      if (res.ok) router.refresh();
      else toast.error(t("saveError"));
    });
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="gap-1" render={<Link href={prevHref} />}>
          <ChevronLeft className="size-4" />
          {t("prevMonth")}
        </Button>
        <span className="font-semibold">{monthLabel}</span>
        <Button variant="ghost" size="sm" className="gap-1" render={<Link href={nextHref} />}>
          {t("nextMonth")}
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {weekdays.map((w, i) => (
          <div key={i} className="py-1 text-center text-xs font-medium text-muted-foreground">
            {w}
          </div>
        ))}
        {weeks.flat().map((cell, i) =>
          cell.day === null ? (
            <div key={i} />
          ) : (
            <button
              key={i}
              type="button"
              disabled={cell.status === "assigned" || pending}
              onClick={() => toggle(cell)}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md border text-sm transition-colors",
                cell.status === "available" && "hover:bg-muted",
                cell.status === "unavailable" &&
                  "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20",
                cell.status === "assigned" &&
                  "cursor-not-allowed border-primary/30 bg-primary/10 text-primary",
                cell.isToday && "ring-2 ring-ring",
              )}
            >
              {cell.day}
            </button>
          ),
        )}
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <Legend className="border" label={t("available")} />
        <Legend className="border-destructive/30 bg-destructive/10" label={t("unavailable")} />
        <Legend className="border-primary/30 bg-primary/10" label={t("assigned")} />
      </div>
      <p className="text-xs text-muted-foreground">{t("legend")}</p>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-3 rounded border", className)} />
      {label}
    </span>
  );
}
