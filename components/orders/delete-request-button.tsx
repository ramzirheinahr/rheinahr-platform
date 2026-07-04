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
import { deleteOrderRequest } from "@/app/[locale]/client/orders/actions";
import { deleteOrderRequestAsAdmin } from "@/app/[locale]/admin/orders/actions";
import { Trash2 } from "lucide-react";

// Red destructive action inside the request edit screen. Deletes the whole
// request (all its shifts) after an explicit confirmation. Routes to the admin
// or client delete action depending on who is editing, then returns to the list.
export function DeleteRequestButton({
  requestGroupId,
  adminEdit = false,
}: {
  requestGroupId: string;
  adminEdit?: boolean;
}) {
  const o = useTranslations("orders");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function remove() {
    startTransition(async () => {
      const res = adminEdit
        ? await deleteOrderRequestAsAdmin(requestGroupId)
        : await deleteOrderRequest(requestGroupId);
      if (res.ok) {
        toast.success(o("deleted"));
        setOpen(false);
        router.push(adminEdit ? "/admin/orders" : "/client/orders");
        router.refresh();
      } else {
        toast.error(o("saveError"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" className="gap-2" />}>
        <Trash2 className="size-4" />
        {o("deleteRequest")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{o("deleteConfirmTitle")}</DialogTitle>
          <DialogDescription>{o("deleteConfirmDesc")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {c("cancel")}
          </DialogClose>
          <Button
            variant="destructive"
            onClick={remove}
            disabled={pending}
            className="gap-2"
          >
            <Trash2 className="size-4" />
            {pending ? c("loading") : o("deleteRequest")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
