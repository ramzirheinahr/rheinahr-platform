"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { orderStatuses } from "@/lib/validations";
import { updateOrderStatus } from "@/app/[locale]/admin/orders/actions";
import type { OrderStatus } from "@prisma/client";

// Status is changed by clicking its button directly (no dropdown) — the current
// status is highlighted, and a click applies the new status immediately.
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
  const [pending, startTransition] = useTransition();

  function setStatus(status: OrderStatus) {
    if (status === current || pending) return;
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
    <div className="space-y-2">
      <span className="text-sm font-medium">{t("updateStatus")}</span>
      <div className="flex flex-wrap gap-2">
        {orderStatuses.map((s) => {
          const active = s === current;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s as OrderStatus)}
              disabled={pending || active}
              aria-pressed={active}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-50",
              )}
            >
              {es(s)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
