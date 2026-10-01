"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import { EmailRecipientsDialog } from "./email-recipients-dialog";
import { sendOrderScheduleEmail } from "@/app/[locale]/admin/orders/[id]/schedule-email-actions";
import { toast } from "sonner";

export function SendOrderEmailButton({
  requestGroupId,
  facilityName,
  className,
}: {
  requestGroupId: string;
  facilityName?: string;
  className?: string;
}) {
  const t = useTranslations("emailDialog");
  const [open, setOpen] = useState(false);

  const handleSend = async (recipients: string[]) => {
    const res = await sendOrderScheduleEmail({
      requestGroupId,
      recipients,
    });
    if (!res.ok) {
      throw new Error(res.error || "Fehler beim Senden der E-Mail");
    }
    toast.success(t("sendSuccess"));
  };

  return (
    <>
      <Button
        variant="outline"
        className={className || "gap-2"}
        onClick={() => setOpen(true)}
      >
        <Mail className="size-4 text-blue-600" />
        {t("sendEmailButton")}
      </Button>

      <EmailRecipientsDialog
        open={open}
        onOpenChange={setOpen}
        title={t("orderScheduleTitle")}
        requestGroupId={requestGroupId}
        facilityName={facilityName}
        onSend={handleSend}
      />
    </>
  );
}
