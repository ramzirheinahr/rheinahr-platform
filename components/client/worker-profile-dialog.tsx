"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { WorkerProfile } from "@/components/worker/worker-profile";
import { getWorkerProfilePreview } from "@/app/[locale]/client/orders/actions";
import type { WorkerProfileData } from "@/lib/worker-profile";
import { Loader2 } from "lucide-react";

export function WorkerProfileDialog({
  workerId,
  children,
}: {
  workerId: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<WorkerProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const t = useTranslations("common");

  async function handleOpen(isOpen: boolean) {
    setOpen(isOpen);
    if (isOpen && !data) {
      setLoading(true);
      const res = await getWorkerProfilePreview(workerId);
      setData(res);
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={children as React.ReactElement} />
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto sm:rounded-xl p-0 border-none bg-transparent shadow-none">
        {loading ? (
          <div className="flex h-40 items-center justify-center bg-background rounded-xl border">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : data ? (
          <WorkerProfile data={data} />
        ) : (
          <div className="flex h-40 items-center justify-center text-muted-foreground bg-background rounded-xl border">
            {t("error")}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
