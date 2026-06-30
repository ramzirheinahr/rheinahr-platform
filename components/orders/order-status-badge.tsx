import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@prisma/client";

const variant: Record<
  OrderStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "secondary",
  review: "secondary",
  availability_check: "secondary",
  assigned: "default",
  accepted: "default",
  in_progress: "default",
  completed: "default",
  confirmed: "default",
  cancelled: "outline",
};

// Works in both server and client components (next-intl useTranslations).
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations("enums.orderStatus");
  return <Badge variant={variant[status]}>{t(status)}</Badge>;
}
