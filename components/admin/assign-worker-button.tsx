"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UserPlus } from "lucide-react";
import { assignWorker } from "@/app/[locale]/admin/orders/actions";

export function AssignWorkerButton({
  orderId,
  workerId,
  workerName,
  conflicts,
}: {
  orderId: string;
  workerId: string;
  workerName?: string;
  conflicts?: {
    facilityName: string;
    startTime: string;
    endTime: string;
    overlaps: boolean;
  }[];
}) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onAssign() {
    if (conflicts && conflicts.length > 0) {
      const hasOverlap = conflicts.some((c) => c.overlaps);
      const conflictMsg = conflicts
        .map((c) => `${c.overlaps ? "⚠️ Zeitüberschneidung" : "ℹ️ Bereits eingeteilt"}: ${c.startTime}–${c.endTime} (${c.facilityName})`)
        .join("\n");
      const promptText = hasOverlap
        ? `Achtung: Zeitüberschneidung!\n\n${workerName || "Dieser Mitarbeiter"} ist zur gleichen Zeit bereits eingeteilt:\n\n${conflictMsg}\n\nMöchten Sie die Schicht trotzdem zuweisen?`
        : `Achtung: ${workerName || "Dieser Mitarbeiter"} hat am selben Tag bereits folgende Schicht(en):\n\n${conflictMsg}\n\nMöchten Sie die Schicht trotzdem zuweisen?`;
      
      const confirmed = window.confirm(promptText);
      if (!confirmed) return;
    }

    startTransition(async () => {
      const res = await assignWorker(orderId, workerId);
      if (res.ok) {
        toast.success(t("assigned"));
        router.refresh();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <Button
      size="sm"
      variant="secondary"
      className="gap-2 shrink-0"
      disabled={pending}
      onClick={onAssign}
    >
      <UserPlus className="size-4" />
      {t("assign")}
    </Button>
  );
}
