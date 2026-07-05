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
import { qualifications, contractTypes } from "@/lib/validations";
import { PasswordField } from "@/components/admin/password-field";
import { LanguageSelect } from "@/components/admin/language-select";
import { NationalitySelect } from "@/components/admin/nationality-select";
import { createWorker } from "@/app/[locale]/admin/workers/actions";

const textareaClass =
  "flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Creates a worker together with their login account (super_admin only) —
// profile and credentials in one step, no separate accounts page.
export function WorkerCreateForm({
  initialQualification,
}: {
  initialQualification?: string;
}) {
  const t = useTranslations("workers");
  const ta = useTranslations("accounts");
  const c = useTranslations("common");
  const eq = useTranslations("enums.qualification");
  const ec = useTranslations("enums.contractType");
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
        <PasswordField placeholder={ta("passwordHint")} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("qualification")}</Label>
          <Select
            name="qualification"
            defaultValue={initialQualification ?? qualifications[0]}
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

      {/* Personal / HR data — sensitive, admin-only, never shown to clients. */}
      <fieldset className="space-y-5 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("personalSection")}</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="birthDate">{t("birthDate")}</Label>
            <Input id="birthDate" name="birthDate" type="date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="birthPlace">{t("birthPlace")}</Label>
            <Input id="birthPlace" name="birthPlace" />
          </div>
          <div className="space-y-2">
            <Label>{t("nationality")}</Label>
            <NationalitySelect />
          </div>
          <div className="space-y-2">
            <Label htmlFor="socialSecurityNumber">{t("socialSecurityNumber")}</Label>
            <Input id="socialSecurityNumber" name="socialSecurityNumber" />
          </div>
        </div>
      </fieldset>

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

      {/* Professional profile — may be shown to clients. */}
      <fieldset className="space-y-5 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("profileSection")}</legend>
        <div className="space-y-2">
          <Label>{t("languages")}</Label>
          <LanguageSelect />
        </div>
        <div className="space-y-2">
          <Label htmlFor="skills">{t("skills")}</Label>
          <Input id="skills" name="skills" placeholder={t("skillsHint")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="certifications">{t("certifications")}</Label>
          <Input
            id="certifications"
            name="certifications"
            placeholder={t("certificationsHint")}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="yearsExperience">{t("yearsExperience")}</Label>
            <Input
              id="yearsExperience"
              name="yearsExperience"
              type="number"
              min={0}
              max={80}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="employedSince">{t("employedSince")}</Label>
            <Input id="employedSince" name="employedSince" type="date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="requiredHours">{t("requiredHours")}</Label>
            <Input
              id="requiredHours"
              name="requiredHours"
              type="number"
              step="0.01"
              min={0}
              max={744}
              defaultValue={151.67}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="carryoverHours">{t("carryoverHours")}</Label>
            <Input
              id="carryoverHours"
              name="carryoverHours"
              type="number"
              step="0.01"
              defaultValue={0}
            />
            <p className="text-xs text-muted-foreground">{t("carryoverHoursHint")}</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="bio">{t("bio")}</Label>
          <textarea
            id="bio"
            name="bio"
            className={textareaClass}
            placeholder={t("bioHint")}
          />
        </div>
      </fieldset>

      <p className="text-xs text-muted-foreground">{t("uploadsHint")}</p>

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
