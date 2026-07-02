"use client";

import { useState, useRef, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UserRound, Upload, Trash2 } from "lucide-react";
import {
  uploadWorkerPhoto,
  deleteWorkerPhoto,
} from "@/app/[locale]/admin/workers/file-actions";

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
    const fd = new FormData();
    fd.append("photo", file);
    start(async () => {
      const res = await uploadWorkerPhoto(workerId, fd);
      if (res.ok) {
        setPhoto(true);
        setV((x) => x + 1);
        toast.success(t("photoUploaded"));
      } else {
        toast.error(t(errKey(res.error)));
      }
      if (inputRef.current) inputRef.current.value = "";
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
