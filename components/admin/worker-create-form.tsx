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
import { createWorker } from "@/app/[locale]/admin/workers/actions";

// Creates a worker together with their login account (super_admin only) —
// profile and credentials in one step, no separate accounts page.
export function WorkerCreateForm() {
  const t = useTranslations("workers");
  const ta = useTranslations("accounts");
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
      const res = await createWorker(formData);
      if (res.ok) {
        toast.success(t("created"));
        router.push("/admin/workers");
        router.refresh();
      } else {
        toast.error(t(res.error === "emailInUse" ? "emailInUse" : "saveError"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">{t("fullName")}</Label>
          <Input id="fullName" name="fullName" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" required />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">{ta("password")}</Label>
        <Input
          id="password"
          name="password"
          type="text"
          minLength={12}
          placeholder={ta("passwordHint")}
          required
          className="sm:max-w-sm"
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("qualification")}</Label>
          <Select name="qualification" defaultValue={qualifications[0]}>
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
          <Select name="contractType" defaultValue={contractTypes[0]}>
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
          <Input id="phone" name="phone" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">{t("address")}</Label>
          <Input id="address" name="address" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="certifications">{t("certifications")}</Label>
        <Input
          id="certifications"
          name="certifications"
          placeholder={t("certificationsHint")}
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
                className="size-4 accent-primary"
              />
              {el(l)}
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? c("loading") : c("create")}
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
