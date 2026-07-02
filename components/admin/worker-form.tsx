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
import { LanguageSelect } from "@/components/admin/language-select";
import { NationalitySelect } from "@/components/admin/nationality-select";
import { updateWorker } from "@/app/[locale]/admin/workers/actions";

export type WorkerData = {
  id: string;
  fullName: string;
  qualification: string;
  contractType: string;
  phone: string | null;
  address: string | null;
  certifications: string[];
  skills: string[];
  languages: string[];
  birthDate: string | null; // yyyy-mm-dd
  birthPlace: string | null;
  nationality: string | null;
  socialSecurityNumber: string | null;
  bio: string | null;
  yearsExperience: number | null;
  employedSince: string | null; // yyyy-mm-dd
};

const textareaClass =
  "flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Edits an existing worker profile; the login account is managed in the
// AccountSection rendered next to this form.
export function WorkerForm({ worker }: { worker: WorkerData }) {
  const t = useTranslations("workers");
  const c = useTranslations("common");
  const eq = useTranslations("enums.qualification");
  const ec = useTranslations("enums.contractType");
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
      <div className="space-y-2">
        <Label htmlFor="fullName">{t("fullName")}</Label>
        <Input id="fullName" name="fullName" required defaultValue={worker.fullName} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("qualification")}</Label>
          <Select name="qualification" defaultValue={worker.qualification}>
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
          <Select name="contractType" defaultValue={worker.contractType}>
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
            <Input
              id="birthDate"
              name="birthDate"
              type="date"
              defaultValue={worker.birthDate ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="birthPlace">{t("birthPlace")}</Label>
            <Input
              id="birthPlace"
              name="birthPlace"
              defaultValue={worker.birthPlace ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("nationality")}</Label>
            <NationalitySelect defaultValue={worker.nationality} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="socialSecurityNumber">{t("socialSecurityNumber")}</Label>
            <Input
              id="socialSecurityNumber"
              name="socialSecurityNumber"
              defaultValue={worker.socialSecurityNumber ?? ""}
            />
          </div>
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input id="phone" name="phone" defaultValue={worker.phone ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">{t("address")}</Label>
          <Input id="address" name="address" defaultValue={worker.address ?? ""} />
        </div>
      </div>

      {/* Professional profile — may be shown to clients. */}
      <fieldset className="space-y-5 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("profileSection")}</legend>
        <div className="space-y-2">
          <Label>{t("languages")}</Label>
          <LanguageSelect defaultValue={worker.languages} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="skills">{t("skills")}</Label>
          <Input
            id="skills"
            name="skills"
            placeholder={t("skillsHint")}
            defaultValue={worker.skills.join(", ")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="certifications">{t("certifications")}</Label>
          <Input
            id="certifications"
            name="certifications"
            placeholder={t("certificationsHint")}
            defaultValue={worker.certifications.join(", ")}
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
              defaultValue={worker.yearsExperience ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="employedSince">{t("employedSince")}</Label>
            <Input
              id="employedSince"
              name="employedSince"
              type="date"
              defaultValue={worker.employedSince ?? ""}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="bio">{t("bio")}</Label>
          <textarea
            id="bio"
            name="bio"
            className={textareaClass}
            placeholder={t("bioHint")}
            defaultValue={worker.bio ?? ""}
          />
        </div>
      </fieldset>

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
