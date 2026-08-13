import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Plus, ChevronRight, ChevronLeft } from "lucide-react";
import { OrdersListContent } from "./components/orders-list-content";
import { TableSkeleton } from "@/components/admin/skeletons/table-skeleton";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage(props: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const searchParams = await props.searchParams;
  const monthParam = typeof searchParams?.month === "string" ? searchParams.month : null;
  
  let targetYear = new Date().getUTCFullYear();
  let targetMonth = new Date().getUTCMonth() + 1;
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    targetYear = parseInt(monthParam.slice(0, 4), 10);
    targetMonth = parseInt(monthParam.slice(5, 7), 10);
  }

  const prevMonthStr = `${targetMonth === 1 ? targetYear - 1 : targetYear}-${String(targetMonth === 1 ? 12 : targetMonth - 1).padStart(2, "0")}`;
  const nextMonthStr = `${targetMonth === 12 ? targetYear + 1 : targetYear}-${String(targetMonth === 12 ? 1 : targetMonth + 1).padStart(2, "0")}`;

  const t = await getTranslations("orders");
  const locale = await getLocale();

  const monthName = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "Europe/Berlin" }).format(new Date(Date.UTC(targetYear, targetMonth - 1, 1)));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <div className="flex items-center gap-2 border rounded-md p-1">
          <Link prefetch={true} href={`?month=${prevMonthStr}`} className={buttonVariants({ variant: "ghost", size: "icon", className: "h-8 w-8" })}>
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Link>
          <span className="text-sm font-medium px-4 min-w-32 text-center">{monthName}</span>
          <Link prefetch={true} href={`?month=${nextMonthStr}`} className={buttonVariants({ variant: "ghost", size: "icon", className: "h-8 w-8" })}>
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Link>
        </div>
        <Button className="gap-2" render={<Link href="/admin/orders/new" />}>
          <Plus className="size-4" />
          {t("newOrder")}
        </Button>
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <OrdersListContent targetYear={targetYear} targetMonth={targetMonth} />
      </Suspense>
    </div>
  );
}
