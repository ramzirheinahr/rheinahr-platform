"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { History, Pencil, Trash2, Plus, Calendar, Save } from "lucide-react";
import { saveWorkerSollHours, deleteWorkerSollHours } from "@/app/[locale]/admin/workers/soll-hours/actions";
import { useLocale } from "next-intl";
import type { Locale } from "@/i18n/routing";

type SollHoursRecord = {
  id: string;
  validFrom: string;
  weeklyHours: number;
  monthlyHours: number;
};

interface SollHoursManagerProps {
  workerId: string;
  history: SollHoursRecord[];
}

export function SollHoursManager({ workerId, history }: SollHoursManagerProps) {
  const t = useTranslations("workers");
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState<string | null>(null);

  // Form state
  const [validFrom, setValidFrom] = useState("");
  const [weeklyHours, setWeeklyHours] = useState("");
  const [monthlyHours, setMonthlyHours] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Format "YYYY-MM" to display friendly
  const formatMonth = (ym: string) => {
    const [y, m] = ym.split("-");
    return `${m}.${y}`;
  };

  const resetForm = () => {
    setValidFrom("");
    setWeeklyHours("");
    setMonthlyHours("");
    setEditMode(null);
    setError(null);
  };

  const handleEdit = (record: SollHoursRecord) => {
    setEditMode(record.id);
    setValidFrom(record.validFrom);
    setWeeklyHours(record.weeklyHours.toString());
    setMonthlyHours(record.monthlyHours.toString());
    setError(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("confirmDelete"))) return;
    setLoading(true);
    const res = await deleteWorkerSollHours(locale, id, workerId);
    if (!res.ok) {
      setError(t("deleteError"));
    } else {
      if (editMode === id) resetForm();
    }
    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate validFrom format YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(validFrom)) {
      setError(t("invalidDateFormat"));
      return;
    }

    setLoading(true);
    const fd = new FormData();
    if (editMode) fd.append("id", editMode);
    fd.append("workerId", workerId);
    fd.append("validFrom", validFrom);
    fd.append("weeklyHours", weeklyHours);
    fd.append("monthlyHours", monthlyHours);

    const res = await saveWorkerSollHours(locale, fd);
    if (res.ok) {
      resetForm();
    } else {
      setError(t(res.error as any));
    }
    setLoading(false);
  };

  // Sort descending
  const sortedHistory = [...history].sort((a, b) => b.validFrom.localeCompare(a.validFrom));

  return (
    <Dialog open={open} onOpenChange={(val) => { setOpen(val); if (!val) resetForm(); }}>
      <DialogTrigger render={
        <Button type="button" variant="outline" size="sm" className="gap-2">
          <History className="size-4" />
          {t("sollHoursHistory")}
        </Button>
      }>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("sollHoursHistory")}</DialogTitle>
          <DialogDescription>
            {t("sollHoursDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 py-4 space-y-6">
          <form onSubmit={handleSubmit} className="p-4 bg-muted/50 rounded-lg border flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>{t("sollHoursBegin")}</Label>
                <div className="relative">
                  <Input 
                    type="month" 
                    value={validFrom} 
                    onChange={e => setValidFrom(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("weeklyHours")}</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  value={weeklyHours} 
                  onChange={e => setWeeklyHours(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("requiredHours")}</Label>
                <Input 
                  type="number" 
                  step="0.01" 
                  value={monthlyHours} 
                  onChange={e => setMonthlyHours(e.target.value)}
                  required
                />
              </div>
            </div>
            
            <div className="flex justify-between items-center">
              {error ? <span className="text-sm text-destructive">{error}</span> : <span />}
              <div className="flex gap-2">
                {editMode && (
                  <Button type="button" variant="ghost" onClick={resetForm}>
                    {t("cancel")}
                  </Button>
                )}
                <Button type="submit" disabled={loading} className="gap-2">
                  <Save className="size-4" />
                  {t("save")}
                </Button>
              </div>
            </div>
          </form>

          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-start font-medium">{t("sollHoursBegin")}</th>
                  <th className="p-2 text-start font-medium">{t("weeklyHours")}</th>
                  <th className="p-2 text-start font-medium">{t("requiredHours")}</th>
                  <th className="p-2 text-end font-medium">{t("actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y bg-background">
                {sortedHistory.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-muted-foreground">
                      {t("noData")}
                    </td>
                  </tr>
                ) : (
                  sortedHistory.map(record => (
                    <tr key={record.id} className={editMode === record.id ? "bg-accent/50" : ""}>
                      <td className="p-2">{formatMonth(record.validFrom)}</td>
                      <td className="p-2">{record.weeklyHours}</td>
                      <td className="p-2">{record.monthlyHours}</td>
                      <td className="p-2 text-end flex justify-end gap-1">
                        <Button 
                          type="button" 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7" 
                          onClick={() => handleEdit(record)}
                        >
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </Button>
                        <Button 
                          type="button" 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleDelete(record.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
