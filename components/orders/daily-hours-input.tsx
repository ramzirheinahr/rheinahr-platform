"use client";

import { useTransition, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { setWorkerDailyHoursAdjustment } from "@/app/[locale]/admin/workers/[id]/schedule/actions";
import { Loader2 } from "lucide-react";

export function DailyHoursInput({
  workerId,
  date,
  initialHours = 0,
}: {
  workerId: string;
  date: string;
  initialHours?: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState((initialHours ?? 0).toString());

  useEffect(() => {
    setValue((initialHours ?? 0).toString());
  }, [initialHours]);

  const handleBlur = () => {
    const parsed = parseFloat(value);
    const finalVal = isNaN(parsed) ? 0 : parsed;
    setValue(finalVal.toString());

    if (finalVal !== (initialHours ?? 0)) {
      startTransition(async () => {
        await setWorkerDailyHoursAdjustment(workerId, date, finalVal);
        router.refresh();
      });
    }
  };

  return (
    <div className="relative flex items-center justify-center">
      <input
        type="number"
        step="0.25"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        disabled={isPending}
        className="w-16 rounded border border-input bg-background px-1.5 py-0.5 text-center text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        title="Tagesstunden anpassen"
      />
      {isPending && (
        <Loader2 className="absolute right-1 size-3 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
