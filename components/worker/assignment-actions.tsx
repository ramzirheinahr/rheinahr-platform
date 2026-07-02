"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import { respondAssignment } from "@/app/[locale]/worker/assignments/actions";

export function AssignmentActions({ assignmentId }: { assignmentId: string }) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function respond(accept: boolean) {
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

  return (
    <div className="flex gap-2">
      <Button size="sm" className="gap-2" disabled={pending} onClick={() => respond(true)}>
        <Check className="size-4" />
        {t("accept")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="gap-2"
        disabled={pending}
        onClick={() => respond(false)}
      >
        <X className="size-4" />
        {t("decline")}
      </Button>
    </div>
  );
}
