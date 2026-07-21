"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function MonthPicker({ currentMonth }: { currentMonth: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Generate last 12 months
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(d);
    months.push({ value, label });
  }

  const handleChange = (val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", val);
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="w-[200px]">
      <Select value={currentMonth} onValueChange={handleChange}>
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
