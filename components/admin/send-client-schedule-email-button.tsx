"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import { EmailRecipientsDialog } from "./email-recipients-dialog";
import { sendClientMonthScheduleEmail } from "@/app/[locale]/admin/clients/[id]/schedule/actions";
import { toast } from "sonner";

export function SendClientScheduleEmailButton({
  clientId,
  year,
  month,
  facilityName,
  className,
}: {
  clientId: string;
  year: number;
  month: number;
  facilityName?: string;
  className?: string;
}) {
  const t = useTranslations("emailDialog");
  const [open, setOpen] = useState(false);

  const handleSend = async (recipients: string[]) => {
    const res = await sendClientMonthScheduleEmail({
      clientId,
      year,
      month,
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
        size="sm"
        className={className || "gap-2"}
        onClick={() => setOpen(true)}
      >
        <Mail className="size-4 text-blue-600" />
        {t("sendEmailButton")}
      </Button>

      <EmailRecipientsDialog
        open={open}
        onOpenChange={setOpen}
        title={t("monthScheduleTitle")}
        clientId={clientId}
        facilityName={facilityName}
        onSend={handleSend}
      />
    </>
  );
}
