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
}: {
  orderId: string;
  workerId: string;
}) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onAssign() {
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
    <Button size="sm" variant="secondary" className="gap-2" disabled={pending} onClick={onAssign}>
      <UserPlus className="size-4" />
      {t("assign")}
    </Button>
  );
}
