"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export type SelectableAssignment = {
  id: string;
  workerName: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
};

export function SelectAssignmentsDialog({
  assignments,
  title,
  description,
  submitLabel,
  buttonIcon: Icon = Plus,
  buttonLabel,
  buttonClassName,
  onSubmit,
}: {
  assignments: SelectableAssignment[];
  title: string;
  description: string;
  submitLabel: string;
  buttonIcon?: any;
  buttonLabel: string;
  buttonClassName?: string;
  onSubmit: (selectedIds: string[], customInvoiceNumber?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(assignments.map((a) => a.id)));
  const [submitting, setSubmitting] = useState(false);
  const [customInvoiceNumber, setCustomInvoiceNumber] = useState("");

  const toggleAssignment = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setSelectedIds(new Set(assignments.map((a) => a.id)));
      setCustomInvoiceNumber("");
    }
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    try {
      await onSubmit(Array.from(selectedIds), customInvoiceNumber);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" className={buttonClassName} />}>
        <Icon className="size-4 mr-2" />
        {buttonLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {assignments.map((a) => (
            <div key={a.id} className="flex items-center space-x-3 rounded-md border p-3 hover:bg-slate-50 transition-colors">
              <input
                type="checkbox"
                id={`assign-${a.id}`}
                className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                checked={selectedIds.has(a.id)}
                onChange={() => toggleAssignment(a.id)}
              />
              <div className="space-y-1 leading-none">
                <label
                  htmlFor={`assign-${a.id}`}
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  {a.workerName}
                </label>
                <p className="text-xs text-muted-foreground">
                  {a.shiftDate} · {a.startTime} - {a.endTime}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="px-1 py-2">
          <label className="text-sm font-medium mb-1.5 block">Manuelle Rechnungsnummer (Optional)</label>
          <input
            type="text"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Wird andernfalls automatisch generiert..."
            value={customInvoiceNumber}
            onChange={(e) => setCustomInvoiceNumber(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Abbrechen
          </Button>
          <Button onClick={handleSubmit} disabled={selectedIds.size === 0 || submitting}>
            {submitting ? "Wird ausgeführt..." : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
