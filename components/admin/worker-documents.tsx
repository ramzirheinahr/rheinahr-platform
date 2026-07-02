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
import {
  uploadWorkerDocument,
  deleteWorkerDocument,
  setWorkerDocumentVerified,
} from "@/app/[locale]/admin/workers/file-actions";

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
    const fd = new FormData();
    fd.append("category", category);
    fd.append("document", file);
    start(async () => {
      const res = await uploadWorkerDocument(workerId, fd);
      if (res.ok) {
        toast.success(t("documentUploaded"));
        router.refresh();
      } else {
        toast.error(t(errKey(res.error)));
      }
      if (inputRef.current) inputRef.current.value = "";
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
