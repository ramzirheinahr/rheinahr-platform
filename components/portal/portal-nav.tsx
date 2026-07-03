"use client";

import { usePathname, Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

// A nav entry. `children`, when present, turns the entry into a dropdown (e.g.
// "Care staff" → one page per qualification). `badge` renders an unread-count
// chip (e.g. the inbox).
export type NavItem = {
  href: string;
  label: string;
  children?: NavItem[];
  badge?: number;
};

export function PortalNav({
  items,
  orientation = "vertical",
}: {
  items: NavItem[];
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const horizontal = orientation === "horizontal";
  const currentQ = searchParams.get("qualification");

  const linkClass = (active: boolean) =>
    cn(
      "rounded-md px-3 py-2 text-sm transition-colors",
      horizontal && "whitespace-nowrap",
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

  return (
    <nav className={cn("flex gap-1", horizontal ? "flex-row" : "flex-col")}>
      {items.map((item) => {
        if (item.children?.length) {
          return (
            <DropdownMenu key={item.href}>
              <DropdownMenuTrigger
                className={cn(
                  linkClass(onPath(item.href)),
                  "flex items-center gap-1",
                  horizontal ? "" : "justify-between",
                )}
              >
                {item.label}
                <ChevronDown className="size-4" />
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
            className={cn(
              linkClass(onPath(item.href)),
              "flex items-center gap-2",
              !horizontal && "justify-between",
            )}
          >
            {item.label}
            {item.badge ? (
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
