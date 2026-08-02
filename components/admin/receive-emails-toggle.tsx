"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setAccountReceiveEmails } from "@/app/[locale]/admin/account-actions";

export function ReceiveEmailsToggle({ userId, initialValue }: { userId: string, initialValue: boolean }) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.checked;
    startTransition(async () => {
      try {
        const res = await setAccountReceiveEmails(userId, newValue);
        if (!res.ok) {
          toast.error("Fehler beim Aktualisieren der E-Mail-Einstellungen");
        }
      } catch (err) {
        toast.error("Fehler beim Aktualisieren der E-Mail-Einstellungen");
      }
    });
  };

  return (
    <div className="flex items-center justify-center">
      <input
        type="checkbox"
        defaultChecked={initialValue}
        onChange={handleToggle}
        disabled={isPending}
        className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600 cursor-pointer disabled:opacity-50"
        title="E-Mail Benachrichtigungen"
      />
    </div>
  );
}
