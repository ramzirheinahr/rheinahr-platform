"use client";

import { useTransition, useState, useEffect } from "react";
import { updateAssignmentBonusHours } from "@/app/[locale]/admin/orders/actions";
import { Loader2 } from "lucide-react";

export function BonusHoursInput({
  assignmentId,
  initialBonusHours = 0,
}: {
  assignmentId: string;
  initialBonusHours?: number | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState((initialBonusHours ?? 0).toString());

  useEffect(() => {
    setValue((initialBonusHours ?? 0).toString());
  }, [initialBonusHours]);

  const handleBlur = () => {
    const parsed = parseFloat(value);
    const finalVal = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setValue(finalVal.toString());

    if (finalVal !== initialBonusHours) {
      startTransition(async () => {
        await updateAssignmentBonusHours(assignmentId, finalVal);
      });
    }
  };

  return (
    <div className="relative flex items-center">
      <input
        type="number"
        step="0.25"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        disabled={isPending}
        className="w-16 rounded border border-input bg-background px-1.5 py-0.5 text-center text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        title="Bonusstunden bearbeiten"
      />
      {isPending && (
        <Loader2 className="absolute right-1 size-3 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
