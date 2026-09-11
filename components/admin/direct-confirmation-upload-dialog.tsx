"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { Upload, CheckCircle2, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { 
  createConfirmationUploadTicket, 
  finalizeDirectSignedConfirmation,
  uploadDirectSignedConfirmation
} from "@/app/[locale]/admin/orders/[id]/confirmation-actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type SelectableConfirmationAssignment = {
  id: string;
  workerName: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  hasConfirmation?: boolean;
};

export function DirectConfirmationUploadDialog({
  assignments,
  requestGroupId,
  buttonClassName,
  onSubmit,
}: {
  assignments: SelectableConfirmationAssignment[];
  requestGroupId?: string;
  buttonClassName?: string;
  onSubmit?: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const t = useTranslations("confirmations");
  const c = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => {
      const unconfirmed = assignments.filter((a) => !a.hasConfirmation).map((a) => a.id);
      return new Set(unconfirmed.length > 0 ? unconfirmed : assignments.map((a) => a.id));
    },
  );
  const [submitting, setSubmitting] = useState(false);
  const [workerFilter, setWorkerFilter] = useState<string>("all");
  const [signerName, setSignerName] = useState("");

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
      const unconfirmed = assignments.filter((a) => !a.hasConfirmation).map((a) => a.id);
      setSelectedIds(new Set(unconfirmed.length > 0 ? unconfirmed : assignments.map((a) => a.id)));
      setWorkerFilter("all");
      setSelectedFile(null);
    }
  };

  const formAction = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (selectedIds.size === 0) {
      toast.error(t("noShiftsSelected") || "Bitte mindestens eine Schicht auswählen.");
      return;
    }
    if (!selectedFile) {
      toast.error(t("fileRequired") || "Bitte eine Datei auswählen.");
      return;
    }

    setSubmitting(true);
    try {
      if (onSubmit) {
        const formData = new FormData(e.currentTarget);
        formData.set("assignmentIds", JSON.stringify(Array.from(selectedIds)));
        if (requestGroupId) formData.set("requestGroupId", requestGroupId);
        if (signerName.trim()) formData.set("signerName", signerName.trim());
        formData.set("document", selectedFile);
        await onSubmit(formData);
        setOpen(false);
        return;
      }

      // Step 1: Request signed upload ticket
      const ticket = await createConfirmationUploadTicket({
        requestGroupId: requestGroupId || "general",
        fileName: selectedFile.name,
        fileType: selectedFile.type,
        fileSize: selectedFile.size,
      });

      if (!ticket.ok) {
        throw new Error(ticket.error || t("saveError"));
      }

      // Step 2: Upload directly to Supabase storage from the browser (no serverless payload limit)
      const supabase = createSupabaseBrowserClient();
      let contentType = selectedFile.type?.toLowerCase().split(";")[0]?.trim();
      if (!contentType || contentType === "application/octet-stream") {
        const ext = selectedFile.name.split(".").pop()?.toLowerCase();
        if (ext === "pdf") contentType = "application/pdf";
        else if (ext === "png") contentType = "image/png";
        else if (ext === "jpg" || ext === "jpeg") contentType = "image/jpeg";
        else if (ext === "webp") contentType = "image/webp";
      }
      if (contentType === "image/jpg") contentType = "image/jpeg";
      if (!contentType) contentType = "application/pdf";

      const { error: storageError } = await supabase.storage
        .from("confirmations")
        .uploadToSignedUrl(ticket.path, ticket.token, selectedFile, {
          contentType,
        });

      if (storageError) {
        console.error("Storage uploadToSignedUrl error:", storageError);
        throw new Error(storageError.message || "Fehler beim Hochladen der Datei.");
      }

      // Step 3: Finalize records in DB
      const res = await finalizeDirectSignedConfirmation({
        assignmentIds: Array.from(selectedIds),
        path: ticket.path,
        signerName: signerName.trim() || undefined,
        requestGroupId,
      });

      if (!res.ok) {
        throw new Error(res.error || t("saveError"));
      }

      toast.success(t("uploadSignedSuccess", { count: res.count ?? selectedIds.size }));
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      console.error("Confirmation upload error:", err);
      toast.error(err?.message || t("saveError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" variant="outline" className={buttonClassName} />}>
        <Upload className="size-4 mr-2" />
        {t("uploadSignedBtn")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("uploadSignedTitle")}</DialogTitle>
          <DialogDescription>
            {t("uploadSignedDesc")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={formAction}>
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
                      const unconf = assignments.filter((a) => !a.hasConfirmation).map((a) => a.id);
                      setSelectedIds(new Set(unconf.length > 0 ? unconf : assignments.map((a) => a.id)));
                    }
                  }}
                >
                  <option value="all">{t("allWorkers")} ({assignments.length})</option>
                  {workers.map((w) => (
                    <option key={w} value={w}>
                      {w} ({assignments.filter((a) => a.workerName === w).length})
                    </option>
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
                  {allFilteredSelected ? t("deselectAll") : t("selectAll")}
                </Button>
              </div>
            )}
            
            <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
              {filteredAssignments.map((a) => (
                <div 
                  key={a.id} 
                  className={`flex items-center space-x-3 rounded-md border p-2.5 transition-colors cursor-pointer ${
                    selectedIds.has(a.id) ? "bg-primary/5 border-primary/40" : "hover:bg-slate-50 border-gray-200"
                  }`}
                  onClick={() => toggleAssignment(a.id)}
                >
                  <input
                    type="checkbox"
                    id={`upload-ln-${a.id}`}
                    className="size-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                    checked={selectedIds.has(a.id)}
                    onChange={() => {}} // Handled by outer click
                  />
                  <div className="flex-1 space-y-0.5 leading-none">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={`upload-ln-${a.id}`}
                        className="text-sm font-medium leading-none cursor-pointer"
                      >
                        {a.workerName}
                      </label>
                      {a.hasConfirmation && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-normal text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                          <CheckCircle2 className="size-3" />
                          {t("confirmedBadge")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {a.shiftDate} · {a.startTime} – {a.endTime}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-2 text-xs text-muted-foreground flex justify-between">
              <span>{t("selectedCount", { selected: selectedIds.size, total: filteredAssignments.length })}</span>
            </div>
          </div>

          <div className="space-y-3 py-3 border-t mt-2">
            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("signerFacilityLabel")}
              </label>
              <Input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder={t("signerFacilityPlaceholder")}
                className="h-9 text-sm"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("signedDocLabel")} <span className="text-destructive">*</span>
              </label>
              <Input 
                type="file" 
                name="document" 
                accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp" 
                required 
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="cursor-pointer" 
              />
              {selectedFile ? (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-800 dark:text-emerald-300 font-semibold bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded px-2 py-1">
                  <FileText className="size-3.5 shrink-0 text-emerald-600" />
                  <span className="truncate">{selectedFile.name}</span>
                  <span className="shrink-0 text-muted-foreground">({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)</span>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {t("signedDocHint")}
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="mt-3">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              {c("cancel")}
            </Button>
            <Button 
              type="submit" 
              disabled={selectedIds.size === 0 || submitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {submitting ? t("uploading") : t("uploadSignedSubmit", { count: selectedIds.size })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
