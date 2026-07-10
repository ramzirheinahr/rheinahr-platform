"use client";

import { useEffect, useState } from "react";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { PortalNav, type NavItem } from "@/components/portal/portal-nav";

const STORAGE_KEY = "sidebar-collapsed";

// Claude-style desktop sidebar: full labels or an icon-only rail, toggled by a
// button and remembered per browser. The wide master Dienstplan needs the room,
// so on that route the rail is collapsed by default every visit — unless the
// admin expands it during that visit.
export function PortalSidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname(); // locale-stripped, e.g. "/admin/schedule"
  const c = useTranslations("common");
  const isWide = pathname === "/admin/schedule" || pathname.startsWith("/admin/schedule/");
  const [collapsed, setCollapsed] = useState(isWide);

  // On every navigation: collapse on the wide route, otherwise restore the
  // stored preference. A toggle within the same route stays until the next nav.
  useEffect(() => {
    setTimeout(() => {
      if (isWide) {
        setCollapsed(true);
      } else {
        setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
      }
    }, 0);
  }, [pathname, isWide]);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      // Persist only off the wide route — there the collapse is route-driven.
      if (!isWide) localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "hidden shrink-0 border-e md:block",
        collapsed ? "w-16" : "w-56",
      )}
    >
      <div className="sticky top-0 flex flex-col gap-2 p-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? c("expandMenu") : c("collapseMenu")}
          title={collapsed ? c("expandMenu") : c("collapseMenu")}
          className={cn(
            "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            collapsed ? "self-center" : "self-end",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4 rtl:rotate-180" />
          ) : (
            <PanelLeftClose className="size-4 rtl:rotate-180" />
          )}
        </button>
        <PortalNav items={items} collapsed={collapsed} />
      </div>
    </aside>
  );
}
