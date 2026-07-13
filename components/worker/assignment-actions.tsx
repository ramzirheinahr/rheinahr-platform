"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import { respondAssignment } from "@/app/[locale]/worker/assignments/actions";
import { cn } from "@/lib/utils";

export function AssignmentActions({
  assignmentId,
  declined = false,
  queuedResponse,
  onRespond,
}: {
  assignmentId: string;
  /** Shift was declined (by mistake) — offer a single "accept after all" button. */
  declined?: boolean;
  /** If provided, indicates the pending local response (true for accept, false for decline) */
  queuedResponse?: boolean;
  /** If provided, calls this instead of firing the server action immediately */
  onRespond?: (accept: boolean) => void;
}) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function respond(accept: boolean) {
    if (onRespond) {
      onRespond(accept);
      return;
    }

    startTransition(async () => {
      const res = await respondAssignment(assignmentId, accept);
      if (res.ok) {
        toast.success(accept ? t("accepted") : t("declined"));
        router.refresh();
      } else {
        toast.error(res.error === "shiftFull" ? t("shiftFull") : t("saveError"));
      }
    });
  }

  if (declined) {
    return (
      <Button
        size="sm"
        variant={queuedResponse === true ? "default" : "outline"}
        className={cn("gap-2", queuedResponse === true && "bg-amber-500 hover:bg-amber-600")}
        disabled={pending}
        onClick={() => respond(true)}
      >
        <Check className="size-4" />
        {t("undoDecline")}
      </Button>
    );
  }

  return (
    <div className="flex gap-2">
      <Button 
        size="sm" 
        variant={queuedResponse === true ? "default" : (queuedResponse === false ? "outline" : "default")}
        className={cn("gap-2", queuedResponse === true && "bg-emerald-600 hover:bg-emerald-700")}
        disabled={pending} 
        onClick={() => respond(true)}
      >
        <Check className="size-4" />
        {t("accept")}
      </Button>
      <Button
        size="sm"
        variant={queuedResponse === false ? "default" : "outline"}
        className={cn("gap-2", queuedResponse === false && "bg-rose-600 hover:bg-rose-700 text-white")}
        disabled={pending}
        onClick={() => respond(false)}
      >
        <X className="size-4" />
        {t("decline")}
      </Button>
    </div>
  );
}
