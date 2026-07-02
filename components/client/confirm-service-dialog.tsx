"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SignaturePadField } from "@/components/client/signature-pad-field";
import { FileSignature } from "lucide-react";
import { confirmService } from "@/app/[locale]/client/orders/actions";

export function ConfirmServiceDialog({ assignmentId }: { assignmentId: string }) {
  const t = useTranslations("confirmations");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"electronic" | "upload">("electronic");
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("method", method);
    startTransition(async () => {
      const res = await confirmService(formData);
      if (res.ok) {
        toast.success(t("confirmed"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(t(res.error === "fileRequired" ? "fileRequired" : "saveError"));
      }
    });
  }

  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" className="gap-2">
            <FileSignature className="size-4" />
            {t("confirm")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("legalNote")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="assignmentId" value={assignmentId} />

          <div className="space-y-2">
            <Label htmlFor="hoursWorked">{t("hoursWorked")}</Label>
            <Input
              id="hoursWorked"
              name="hoursWorked"
              type="number"
              step="0.25"
              min={0}
              max={24}
              required
              className="max-w-32"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientNotes">{t("clientNotes")}</Label>
            <Textarea
              id="clientNotes"
              name="clientNotes"
              placeholder={t("clientNotesPlaceholder")}
              className="resize-none"
              rows={3}
            />
          </div>

          <Tabs
            value={method}
            onValueChange={(v) => setMethod(v as "electronic" | "upload")}
          >
            <TabsList className="w-full">
              <TabsTrigger value="electronic">{t("methodElectronic")}</TabsTrigger>
              <TabsTrigger value="upload">{t("methodUpload")}</TabsTrigger>
            </TabsList>
            <TabsContent value="electronic" className="pt-3">
              <SignaturePadField name="signatureData" />
            </TabsContent>
            <TabsContent value="upload" className="pt-3">
              <Input
                name="document"
                type="file"
                accept="image/png,image/jpeg,application/pdf"
              />
              <p className="mt-2 text-xs text-muted-foreground">{t("uploadHint")}</p>
            </TabsContent>
          </Tabs>

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? c("loading") : t("confirm")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
