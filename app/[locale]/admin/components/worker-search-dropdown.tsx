"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Loader2 } from "lucide-react";

export type SearchableWorker = {
  id: string;
  fullName: string;
  internalNumber: string | null;
  phone: string | null;
  email: string;
};

export function WorkerSearchDropdown({
  workers,
  currentWorkerId,
}: {
  workers: SearchableWorker[];
  currentWorkerId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isPending, startTransition] = useTransition();

  const options = workers.map((w) => ({
    value: w.id,
    label: w.fullName,
    hint: `${w.internalNumber || ""} ${w.phone || ""} ${w.email || ""}`,
  }));

  const handleChange = (val: string) => {
    if (!val || val === currentWorkerId) return;
    const q = searchParams.toString();
    const qs = q ? `?${q}` : "";
    startTransition(() => {
      router.push(`/admin/workers/${val}/schedule${qs}`);
    });
  };

  return (
    <div className="flex items-center gap-2">
      <SearchableSelect
        options={options}
        value={currentWorkerId}
        onChange={handleChange}
        placeholder="Mitarbeiter suchen..."
        searchPlaceholder="Name, Nr, Tel, Email..."
        emptyText="Kein Mitarbeiter gefunden"
        className="w-[300px]"
        disabled={isPending}
      />
      {isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
