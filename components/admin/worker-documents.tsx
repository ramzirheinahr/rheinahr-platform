"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Upload, Trash2, Check, ExternalLink } from "lucide-react";
import { documentCategories } from "@/lib/validations";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { WORKER_FILES_BUCKET } from "@/lib/worker-files";
import {
  createWorkerDocumentUpload,
  finalizeWorkerDocument,
  deleteWorkerDocument,
  setWorkerDocumentVerified,
} from "@/app/[locale]/admin/workers/file-actions";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const DOC_TYPES = [...IMAGE_TYPES, "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export type WorkerDoc = {
  id: string;
  category: string;
  fileName: string;
  verified: boolean;
};

const errKey = (e?: string) =>
  e === "fileType" || e === "fileTooLarge" || e === "fileRequired" || e === "forbidden"
    ? e
    : "saveError";

// List + upload of a worker's documents. `canVerify` gates the admin-only
// "verified" toggle; workers can upload/delete their own but not verify.
export function WorkerDocuments({
  workerId,
  documents,
  canVerify,
}: {
  workerId: string;
  documents: WorkerDoc[];
  canVerify: boolean;
}) {
  const t = useTranslations("workers");
  const c = useTranslations("common");
  const ed = useTranslations("enums.documentCategory");
  const router = useRouter();
  const [category, setCategory] = useState<string>(documentCategories[0]);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reset = () => {
      if (inputRef.current) inputRef.current.value = "";
    };
    // Validate up front so we don't request a ticket for an invalid file.
    if (!DOC_TYPES.includes(file.type)) {
      toast.error(t("fileType"));
      reset();
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t("fileTooLarge"));
      reset();
      return;
    }
    const cat = category;
    start(async () => {
      // 1) Ask the server for a one-time signed upload URL (tiny payload).
      const ticket = await createWorkerDocumentUpload(workerId, {
        category: cat,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      });
      if (!ticket.ok) {
        toast.error(t(errKey(ticket.error)));
        reset();
        return;
      }
      // 2) Upload the file straight to Storage from the browser — no size limit
      //    from the Server Action / serverless function.
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.storage
        .from(WORKER_FILES_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
      if (error) {
        toast.error(t("saveError"));
        reset();
        return;
      }
      // 3) Record the document.
      const res = await finalizeWorkerDocument(workerId, {
        category: cat,
        fileName: file.name,
        path: ticket.path,
      });
      if (res.ok) {
        toast.success(t("documentUploaded"));
        router.refresh();
      } else {
        toast.error(t(errKey(res.error)));
      }
      reset();
    });
  }

  function onDelete(id: string) {
    start(async () => {
      const res = await deleteWorkerDocument(id);
      if (res.ok) {
        toast.success(t("documentDeleted"));
        router.refresh();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  function onToggleVerified(id: string, verified: boolean) {
    start(async () => {
      const res = await setWorkerDocumentVerified(id, verified);
      if (res.ok) router.refresh();
      else toast.error(t("saveError"));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("documentCategory")}</label>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v ?? documentCategories[0])}
          >
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {documentCategories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {ed(cat)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          hidden
          onChange={onFile}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          className="gap-2"
        >
          <Upload className="size-4" />
          {t("uploadDocument")}
        </Button>
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noDocuments")}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 p-3">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.fileName}</p>
                <p className="text-xs text-muted-foreground">{ed(d.category)}</p>
              </div>
              {d.verified ? (
                <Badge variant="default" className="gap-1">
                  <Check className="size-3" />
                  {t("verified")}
                </Badge>
              ) : (
                <Badge variant="outline">{t("unverified")}</Badge>
              )}
              <a
                href={`/api/worker-documents/${d.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground"
                aria-label={c("view")}
                title={c("view")}
              >
                <ExternalLink className="size-4" />
              </a>
              {canVerify && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => onToggleVerified(d.id, !d.verified)}
                >
                  {d.verified ? t("unverify") : t("verify")}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={() => onDelete(d.id)}
                aria-label={c("delete")}
                className="text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
