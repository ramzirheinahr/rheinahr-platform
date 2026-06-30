"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { orderStatuses } from "@/lib/validations";
import { updateOrderStatus } from "@/app/[locale]/admin/orders/actions";
import type { OrderStatus } from "@prisma/client";

export function OrderStatusControl({
  orderId,
  current,
}: {
  orderId: string;
  current: OrderStatus;
}) {
  const t = useTranslations("orders");
  const es = useTranslations("enums.orderStatus");
  const router = useRouter();
  const [status, setStatus] = useState<OrderStatus>(current);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await updateOrderStatus(orderId, status);
      if (res.ok) {
        toast.success(t("statusUpdated"));
        router.refresh();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <div className="flex items-end gap-3">
      <div className="space-y-2">
        <span className="text-sm font-medium">{t("updateStatus")}</span>
        <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus)}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {orderStatuses.map((s) => (
              <SelectItem key={s} value={s}>
                {es(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={save} disabled={pending || status === current}>
        {t("updateStatus")}
      </Button>
    </div>
  );
}
