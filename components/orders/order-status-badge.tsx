import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@prisma/client";
import { cn } from "@/lib/utils";

const statusStyles: Record<OrderStatus, string> = {
  pending: "bg-slate-100 text-slate-700 hover:bg-slate-200 border-transparent",
  review: "bg-blue-100 text-blue-700 hover:bg-blue-200 border-transparent",
  availability_check: "bg-amber-100 text-amber-700 hover:bg-amber-200 border-transparent",
  assigned: "bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border-transparent",
  accepted: "bg-teal-100 text-teal-700 hover:bg-teal-200 border-transparent",
  in_progress: "bg-cyan-100 text-cyan-700 hover:bg-cyan-200 border-transparent",
  completed: "bg-purple-100 text-purple-700 hover:bg-purple-200 border-transparent",
  confirmed: "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-transparent",
  cancelled: "bg-red-100 text-red-700 hover:bg-red-200 border-transparent",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations("enums.orderStatus");
  return (
    <Badge variant="outline" className={cn(statusStyles[status], "shadow-none font-medium")}>
      {t(status)}
    </Badge>
  );
}
