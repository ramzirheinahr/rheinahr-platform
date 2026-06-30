"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { deleteClient } from "@/app/[locale]/admin/clients/actions";

export function DeleteClientButton({ id }: { id: string }) {
  const t = useTranslations("clients");
  const c = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (!window.confirm(t("deleteConfirm"))) return;
    startTransition(async () => {
      const res = await deleteClient(id);
      if (res.ok) {
        toast.success(t("deleted"));
        router.push("/admin/clients");
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
