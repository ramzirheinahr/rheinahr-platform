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
import { qualifications, contractTypes, locales } from "@/lib/validations";
import { updateWorker } from "@/app/[locale]/admin/workers/actions";

type WorkerData = {
  id: string;
  fullName: string;
  email: string;
  qualification: string;
  contractType: string;
  phone: string | null;
  address: string | null;
  certifications: string[];
  languages: string[];
};

// Edits an existing worker profile. Account creation lives in /admin/accounts.
export function WorkerForm({ worker }: { worker: WorkerData }) {
  const t = useTranslations("workers");
  const c = useTranslations("common");
  const eq = useTranslations("enums.qualification");
  const ec = useTranslations("enums.contractType");
  const el = useTranslations("enums.language");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateWorker(worker.id, formData);
      if (res.ok) {
        toast.success(t("updated"));
        router.push("/admin/workers");
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
          <Label htmlFor="fullName">{t("fullName")}</Label>
          <Input
            id="fullName"
            name="fullName"
            required
            defaultValue={worker?.fullName}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            disabled
            defaultValue={worker.email}
          />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("qualification")}</Label>
          <Select
            name="qualification"
            defaultValue={worker?.qualification ?? qualifications[0]}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {qualifications.map((q) => (
                <SelectItem key={q} value={q}>
                  {eq(q)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t("contractType")}</Label>
          <Select
            name="contractType"
            defaultValue={worker?.contractType ?? contractTypes[0]}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {contractTypes.map((ct) => (
                <SelectItem key={ct} value={ct}>
                  {ec(ct)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input id="phone" name="phone" defaultValue={worker?.phone ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">{t("address")}</Label>
          <Input
            id="address"
            name="address"
            defaultValue={worker?.address ?? ""}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="certifications">{t("certifications")}</Label>
        <Input
          id="certifications"
          name="certifications"
          placeholder={t("certificationsHint")}
          defaultValue={worker?.certifications.join(", ")}
        />
      </div>

      <div className="space-y-2">
        <Label>{t("languages")}</Label>
        <div className="flex flex-wrap gap-4">
          {locales.map((l) => (
            <label key={l} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="languages"
                value={l}
                defaultChecked={worker?.languages.includes(l)}
                className="size-4 accent-primary"
              />
              {el(l)}
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? c("loading") : c("save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/workers")}
        >
          {c("cancel")}
        </Button>
      </div>
    </form>
  );
}
