"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { facilityTypes } from "@/lib/validations";
import { updateClient } from "@/app/[locale]/admin/clients/actions";

type ClientData = {
  id: string;
  email: string;
  facilityName: string;
  facilityType: string;
  address: string | null;
  contactPerson: string | null;
  billingInfo: string | null;
};

// Edits an existing facility profile. Account creation lives in /admin/accounts.
export function ClientForm({ client }: { client: ClientData }) {
  const t = useTranslations("clients");
  const c = useTranslations("common");
  const ef = useTranslations("enums.facilityType");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateClient(client.id, formData);
      if (res.ok) {
        toast.success(t("updated"));
        router.push("/admin/clients");
        router.refresh();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="facilityName">{t("facilityName")}</Label>
          <Input
            id="facilityName"
            name="facilityName"
            required
            defaultValue={client.facilityName}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("facilityType")}</Label>
          <Select name="facilityType" defaultValue={client.facilityType}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {facilityTypes.map((f) => (
                <SelectItem key={f} value={f}>
                  {ef(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("email")}</Label>
        <Input value={client.email} disabled />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="contactPerson">{t("contactPerson")}</Label>
          <Input
            id="contactPerson"
            name="contactPerson"
            defaultValue={client.contactPerson ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">{t("address")}</Label>
          <Input id="address" name="address" defaultValue={client.address ?? ""} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="billingInfo">{t("billingInfo")}</Label>
        <Input
          id="billingInfo"
          name="billingInfo"
          defaultValue={client.billingInfo ?? ""}
        />
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? c("loading") : c("save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/clients")}
        >
          {c("cancel")}
        </Button>
      </div>
    </form>
  );
}
