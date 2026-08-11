"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ScheduleMonthPicker({ currentYear, currentMonth, baseRoute }: { currentYear: number; currentMonth: number; baseRoute: string }) {
  const router = useRouter();

  // Generate months from 3 months in the future to 12 months in the past
  const months = [];
  const now = new Date();
  for (let i = -3; i <= 12; i++) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const value = `${y}-${m}`;
    const label = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", month: "long", year: "numeric" }).format(d);
    months.push({ value, label, y, m });
  }

  // Prefetch adjacent months in background
  useEffect(() => {
    const nextM = currentMonth === 12 ? 1 : currentMonth + 1;
    const nextY = currentMonth === 12 ? currentYear + 1 : currentYear;
    const prevM = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevY = currentMonth === 1 ? currentYear - 1 : currentYear;

    const prefetch = () => {
      // Include any other search params if needed, but for schedule base is enough
      const hasParams = baseRoute.includes("?");
      const connector = hasParams ? "&" : "?";
      
      router.prefetch(`${baseRoute}${connector}year=${nextY}&month=${nextM}`);
      router.prefetch(`${baseRoute}${connector}year=${prevY}&month=${prevM}`);
    };

    // Small delay to allow the current page to finish rendering before prefetching
    const timer = setTimeout(prefetch, 500);
    return () => clearTimeout(timer);
  }, [currentYear, currentMonth, baseRoute, router]);

  const handleChange = (val: string | null) => {
    if (!val) return;
    const [y, m] = val.split("-");
    
    // Check if URL has existing params (like qualification for master schedule)
    const hasParams = baseRoute.includes("?");
    const connector = hasParams ? "&" : "?";
    
    router.push(`${baseRoute}${connector}year=${y}&month=${m}`);
  };

  const currentValue = `${currentYear}-${currentMonth}`;

  return (
    <div className="w-[200px]">
      <Select value={currentValue} onValueChange={handleChange}>
        <SelectTrigger>
          <SelectValue placeholder="Monat auswählen" />
        </SelectTrigger>
        <SelectContent>
          {months.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
