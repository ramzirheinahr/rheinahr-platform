import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@prisma/client";
import { cn } from "@/lib/utils";

const statusStyles: Record<OrderStatus, string> = {
  pending: "bg-slate-100 text-slate-900 border-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700",
  review: "bg-blue-50 text-blue-950 border-blue-400 dark:bg-blue-950/60 dark:text-blue-100 dark:border-blue-700",
  availability_check: "bg-amber-50 text-amber-950 border-amber-400 dark:bg-amber-950/60 dark:text-amber-100 dark:border-amber-700",
  assigned: "bg-indigo-50 text-indigo-950 border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-100 dark:border-indigo-700",
  accepted: "bg-teal-50 text-teal-950 border-teal-500 dark:bg-teal-950/60 dark:text-teal-100 dark:border-teal-700",
  in_progress: "bg-cyan-50 text-cyan-950 border-cyan-500 dark:bg-cyan-950/60 dark:text-cyan-100 dark:border-cyan-700",
  completed: "bg-purple-50 text-purple-950 border-purple-400 dark:bg-purple-950/60 dark:text-purple-100 dark:border-purple-700",
  confirmed: "bg-emerald-100 text-emerald-950 border-emerald-600 font-bold dark:bg-emerald-950/70 dark:text-emerald-100 dark:border-emerald-600",
  cancelled: "bg-rose-50 text-rose-950 border-rose-400 dark:bg-rose-950/60 dark:text-rose-100 dark:border-rose-700",
};

export function OrderStatusBadge({ status, isPartiallyConfirmed }: { status: OrderStatus, isPartiallyConfirmed?: boolean }) {
  const t = useTranslations("enums.orderStatus");
  const actualStatus = isPartiallyConfirmed ? "partially_confirmed" : status;
  const style = isPartiallyConfirmed
    ? "bg-amber-100 text-amber-950 border-amber-500 font-bold dark:bg-amber-950/70 dark:text-amber-100 dark:border-amber-600"
    : statusStyles[status];
  
  return (
    <Badge variant="outline" className={cn(style, "shadow-sm font-bold text-xs px-2.5 py-0.5 border")}>
      {/* We need to ensure we can cast actualStatus to any because partially_confirmed is not in OrderStatus type but it exists in translations */}
      {t(actualStatus as any)}
    </Badge>
  );
}
