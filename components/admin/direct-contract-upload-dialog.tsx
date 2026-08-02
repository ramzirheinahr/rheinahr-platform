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
import { Upload, FileSignature } from "lucide-react";
import { Input } from "@/components/ui/input";

export type SelectableAssignment = {
  id: string;
  workerName: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
};

export function DirectContractUploadDialog({
  assignments,
  buttonClassName,
  onSubmit,
}: {
  assignments: SelectableAssignment[];
  buttonClassName?: string;
  onSubmit: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(assignments.map((a) => a.id)));
  const [submitting, setSubmitting] = useState(false);
  const [workerFilter, setWorkerFilter] = useState<string>("all");

  const workers = Array.from(new Set(assignments.map((a) => a.workerName))).sort();
  const filteredAssignments = workerFilter === "all" 
    ? assignments 
    : assignments.filter((a) => a.workerName === workerFilter);

  const allFilteredSelected = filteredAssignments.length > 0 && filteredAssignments.every(a => selectedIds.has(a.id));

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
      setWorkerFilter("all");
    }
  };

  const formAction = async (formData: FormData) => {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    
    formData.append("assignmentIds", JSON.stringify(Array.from(selectedIds)));
    
    try {
      await onSubmit(formData);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={buttonClassName}>
          <Upload className="size-4 mr-2" />
          Signierten Vertrag hochladen
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Unterschriebenen Vertrag hochladen</DialogTitle>
          <DialogDescription>
            Wählen Sie die Schichten aus, für die dieser AÜV gilt, und laden Sie das unterschriebene Dokument hoch.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction}>
          <div className="py-2">
            {workers.length > 1 && (
              <div className="mb-2 flex items-center justify-between pb-2 border-b">
                <select
                  className="text-sm border rounded-md px-2 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={workerFilter}
                  onChange={(e) => {
                    const worker = e.target.value;
                    setWorkerFilter(worker);
                    if (worker !== "all") {
                      const workerIds = assignments.filter((a) => a.workerName === worker).map((a) => a.id);
                      setSelectedIds(new Set(workerIds));
                    } else {
                      setSelectedIds(new Set(assignments.map((a) => a.id)));
                    }
                  }}
                >
                  <option value="all">Alle Mitarbeiter</option>
                  {workers.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
                
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    if (allFilteredSelected) {
                      const next = new Set(selectedIds);
                      filteredAssignments.forEach(a => next.delete(a.id));
                      setSelectedIds(next);
                    } else {
                      const next = new Set(selectedIds);
                      filteredAssignments.forEach(a => next.add(a.id));
                      setSelectedIds(next);
                    }
                  }}
                >
                  {allFilteredSelected ? "Auswahl aufheben" : "Alle auswählen"}
                </Button>
              </div>
            )}
            
            <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-1">
              {filteredAssignments.map((a) => (
                <div key={a.id} className="flex items-center space-x-3 rounded-md border p-3 hover:bg-slate-50 transition-colors">
                  <input
                    type="checkbox"
                    id={`upload-assign-${a.id}`}
                    className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                    checked={selectedIds.has(a.id)}
                    onChange={() => toggleAssignment(a.id)}
                  />
                  <div className="space-y-1 leading-none">
                    <label
                      htmlFor={`upload-assign-${a.id}`}
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
          </div>

          <div className="py-4 border-t mt-2">
            <label className="text-sm font-medium mb-1.5 block">Signiertes Dokument (PDF)</label>
            <Input type="file" name="document" accept="application/pdf" required className="cursor-pointer" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={selectedIds.size === 0 || submitting}>
              {submitting ? "Wird hochgeladen..." : "Hochladen & Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
