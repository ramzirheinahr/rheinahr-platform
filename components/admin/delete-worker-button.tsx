"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { deleteWorker } from "@/app/[locale]/admin/workers/actions";

export function DeleteWorkerButton({ id }: { id: string }) {
  const t = useTranslations("workers");
  const c = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (!window.confirm(t("deleteConfirm"))) return;
    startTransition(async () => {
      const res = await deleteWorker(id);
      if (res.ok) {
        toast.success(t("deleted"));
        router.push("/admin/workers");
        router.refresh();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <Button
      type="button"
      variant="destructive"
      className="gap-2"
      disabled={pending}
      onClick={onDelete}
    >
      <Trash2 className="size-4" />
      {c("delete")}
    </Button>
  );
}
