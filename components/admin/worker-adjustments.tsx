"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { addWorkerAdjustment, deleteWorkerAdjustment } from "@/app/[locale]/admin/workers/[id]/schedule/actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AdjustmentInfo = {
  id: string;
  month: string;
  type: "k_ausgleich" | "sonstige";
  hours: number;
  notes: string | null;
};

export function WorkerAdjustments({
  workerId,
  adjustments,
}: {
  workerId: string;
  adjustments: AdjustmentInfo[];
}) {
  const t = useTranslations("portal");
  const c = useTranslations("common");
  const [pending, startTransition] = useTransition();

  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [type, setType] = useState<"k_ausgleich" | "sonstige">("k_ausgleich");
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");

  const handleAdd = () => {
    if (!hours || isNaN(Number(hours))) return;
    
    startTransition(async () => {
      await addWorkerAdjustment(workerId, month, type, Number(hours), notes);
      setHours("");
      setNotes("");
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm(c("confirmDelete"))) return;
    startTransition(async () => {
      await deleteWorkerAdjustment(id);
    });
  };

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="p-6">
        <h3 className="text-lg font-semibold">{t("manualAdjustments")}</h3>
        <p className="text-sm text-muted-foreground mb-4">{t("manualAdjustmentsDesc")}</p>

        <div className="space-y-4">
          {adjustments.length > 0 && (
            <div className="rounded-md border">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="p-2">{t("month")}</th>
                    <th className="p-2">{t("type")}</th>
                    <th className="p-2">{t("hoursUnit")}</th>
                    <th className="p-2">{t("notes")}</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="p-2">{a.month}</td>
                      <td className="p-2">{a.type === "k_ausgleich" ? t("kAusgleich") : t("sonstige")}</td>
                      <td className="p-2">{a.hours}</td>
                      <td className="p-2">{a.notes}</td>
                      <td className="p-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(a.id)}
                          disabled={pending}
                          className="h-8 w-8 text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end bg-muted/30 p-4 rounded-lg">
            <div className="space-y-1.5">
              <Label>{t("month")}</Label>
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("type")}</Label>
              <Select value={type} onValueChange={(v: any) => setType(v)} disabled={pending}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="k_ausgleich">{t("kAusgleich")}</SelectItem>
                  <SelectItem value="sonstige">{t("sonstige")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("hoursUnit")}</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g. 5.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("notes")}</Label>
              <Input
                placeholder="Optional"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={pending}
              />
            </div>
            <Button onClick={handleAdd} disabled={pending || !hours} className="w-full">
              <Plus className="size-4 ltr:mr-2 rtl:ml-2" />
              {c("add")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
