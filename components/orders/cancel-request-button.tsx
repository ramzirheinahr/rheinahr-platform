"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cancelOrderRequest } from "@/app/[locale]/client/orders/actions";
import { cancelOrderRequestAsAdmin } from "@/app/[locale]/admin/orders/actions";
import { Ban } from "lucide-react";

// Permanently delete the whole request (all its shifts) after an explicit
// confirmation — the rows leave the database on the owner's instruction; only
// signed / already-running shifts are refused server-side. Routes to the admin
// or client action depending on who is acting, then returns to the list.
export function CancelRequestButton({
  requestGroupId,
  admin = false,
}: {
  requestGroupId: string;
  admin?: boolean;
}) {
  const o = useTranslations("orders");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function cancel() {
    startTransition(async () => {
      const res = admin
        ? await cancelOrderRequestAsAdmin(requestGroupId)
        : await cancelOrderRequest(requestGroupId);
      if (res.ok) {
        toast.success(o("cancelledToast"));
        setOpen(false);
        router.push(admin ? "/admin/orders" : "/client/orders");
        router.refresh();
      } else {
        toast.error(res.error === "locked" ? o("cancelLocked") : o("saveError"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" className="gap-2" />}>
        <Ban className="size-4" />
        {o("cancelRequest")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{o("cancelConfirmTitle")}</DialogTitle>
          <DialogDescription>{o("cancelConfirmDesc")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{c("cancel")}</DialogClose>
          <Button
            variant="destructive"
            onClick={cancel}
            disabled={pending}
            className="gap-2"
          >
            <Ban className="size-4" />
            {pending ? c("loading") : o("cancelRequest")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
