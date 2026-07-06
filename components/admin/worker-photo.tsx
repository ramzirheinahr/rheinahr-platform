"use client";

import { useState, useRef, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UserRound, Upload, Trash2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { WORKER_FILES_BUCKET } from "@/lib/worker-files";
import {
  createWorkerPhotoUpload,
  finalizeWorkerPhoto,
  deleteWorkerPhoto,
} from "@/app/[locale]/admin/workers/file-actions";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const errKey = (e?: string) =>
  e === "fileType" || e === "fileTooLarge" || e === "fileRequired" || e === "forbidden"
    ? e
    : "saveError";

// Profile-photo upload/preview. The image is served through the signed-URL API
// route; `v` busts the browser cache after an upload.
export function WorkerPhoto({
  workerId,
  hasPhoto,
}: {
  workerId: string;
  hasPhoto: boolean;
}) {
  const t = useTranslations("workers");
  const c = useTranslations("common");
  const [photo, setPhoto] = useState(hasPhoto);
  const [v, setV] = useState(0);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reset = () => {
      if (inputRef.current) inputRef.current.value = "";
    };
    if (!IMAGE_TYPES.includes(file.type)) {
      toast.error(t("fileType"));
      reset();
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t("fileTooLarge"));
      reset();
      return;
    }
    start(async () => {
      // Direct-to-Storage upload via a one-time signed URL (avoids the Server
      // Action / serverless request-body limits that failed on larger files).
      const ticket = await createWorkerPhotoUpload(workerId, {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      });
      if (!ticket.ok) {
        toast.error(t(errKey(ticket.error)));
        reset();
        return;
      }
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.storage
        .from(WORKER_FILES_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
      if (error) {
        toast.error(t("saveError"));
        reset();
        return;
      }
      const res = await finalizeWorkerPhoto(workerId, ticket.path);
      if (res.ok) {
        setPhoto(true);
        setV((x) => x + 1);
        toast.success(t("photoUploaded"));
      } else {
        toast.error(t(errKey(res.error)));
      }
      reset();
    });
  }

  function onDelete() {
    start(async () => {
      const res = await deleteWorkerPhoto(workerId);
      if (res.ok) {
        setPhoto(false);
        toast.success(t("photoDeleted"));
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/workers/${workerId}/photo?v=${v}`}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <UserRound className="size-10 text-muted-foreground" />
        )}
      </div>
      <div className="space-y-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={onFile}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            className="gap-2"
          >
            <Upload className="size-4" />
            {t("uploadPhoto")}
          </Button>
          {photo && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={onDelete}
              className="gap-2 text-destructive"
            >
              <Trash2 className="size-4" />
              {c("delete")}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("photoHint")}</p>
      </div>
    </div>
  );
}
