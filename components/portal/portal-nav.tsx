"use client";

import { usePathname, Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  LayoutDashboard,
  Inbox,
  ClipboardList,
  CalendarDays,
  Users,
  Building2,
  BarChart3,
  Receipt,
  FileText,
  FileSignature,
  CalendarCheck,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

// A nav entry. `children`, when present, turns the entry into a dropdown (e.g.
// "Care staff" → one page per qualification). `badge` renders an unread-count
// chip (e.g. the inbox). `icon` is a serializable key (Server→Client) mapped to
// a lucide icon here.
export type NavItem = {
  href: string;
  label: string;
  icon?: string;
  children?: NavItem[];
  badge?: number;
};

// Icon keys are set in the layouts (server components) and resolved here so the
// non-serializable icon components never cross the Server→Client boundary.
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  inbox: Inbox,
  orders: ClipboardList,
  schedule: CalendarDays,
  workers: Users,
  clients: Building2,
  reports: BarChart3,
  invoicing: Receipt,
  documents: FileText,
  contracts: FileSignature,
  appointments: CalendarCheck,
};

export function PortalNav({
  items,
  orientation = "vertical",
  collapsed = false,
}: {
  items: NavItem[];
  orientation?: "vertical" | "horizontal";
  // Icon-only rail (vertical desktop sidebar collapsed).
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const horizontal = orientation === "horizontal";
  const currentQ = searchParams.get("qualification");

  const linkClass = (active: boolean) =>
    cn(
      "rounded-md px-3 py-2 text-sm transition-colors",
      horizontal && "whitespace-nowrap",
      collapsed && "justify-center px-0",
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  // Base path (before "?") active for the parent trigger.
  const onPath = (href: string) =>
    pathname === href.split("?")[0] || pathname.startsWith(href.split("?")[0] + "/");

  // Exact match including the qualification query param, for child highlighting.
  const childActive = (href: string) => {
    const [path, query] = href.split("?");
    const q = new URLSearchParams(query).get("qualification");
    return pathname === path && (q ?? null) === (currentQ ?? null);
  };

  const iconFor = (item: NavItem) => (item.icon ? ICONS[item.icon] : undefined);

  return (
    <nav className={cn("flex gap-1", horizontal ? "flex-row" : "flex-col")}>
      {items.map((item) => {
        const Icon = iconFor(item);

        if (item.children?.length) {
          return (
            <DropdownMenu key={item.href}>
              <DropdownMenuTrigger
                title={collapsed ? item.label : undefined}
                className={cn(
                  linkClass(onPath(item.href)),
                  "flex items-center gap-2",
                  horizontal ? "" : collapsed ? "justify-center" : "justify-between",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {Icon ? <Icon className="size-4 shrink-0" /> : null}
                  {collapsed ? null : <span className="truncate">{item.label}</span>}
                </span>
                {collapsed ? null : <ChevronDown className="size-4 shrink-0" />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-48">
                {item.children.map((child) => (
                  <DropdownMenuItem
                    key={child.href}
                    className={cn(childActive(child.href) && "bg-accent")}
                    render={<Link href={child.href} />}
                  >
                    {child.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            title={collapsed ? item.label : undefined}
            className={cn(
              linkClass(onPath(item.href)),
              "flex items-center gap-2",
              !horizontal && !collapsed && "justify-between",
            )}
          >
            <span className="relative flex min-w-0 items-center gap-2">
              {Icon ? <Icon className="size-4 shrink-0" /> : null}
              {collapsed ? null : <span className="truncate">{item.label}</span>}
              {/* Collapsed rail: a dot marks unread instead of the number chip. */}
              {collapsed && item.badge ? (
                <span className="absolute -end-1 -top-1 size-2 rounded-full bg-destructive" />
              ) : null}
            </span>
            {!collapsed && item.badge ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-semibold leading-none text-white">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
