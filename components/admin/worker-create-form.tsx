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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { qualifications, contractTypes } from "@/lib/validations";
import { PasswordField } from "@/components/admin/password-field";
import { LanguageSelect } from "@/components/admin/language-select";
import { NationalitySelect } from "@/components/admin/nationality-select";
import { createWorker } from "@/app/[locale]/admin/workers/actions";

const textareaClass =
  "flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
    <form onSubmit={onSubmit} className="max-w-3xl space-y-8 pb-10">
      
      <Card>
        <CardHeader>
          <CardTitle>Profil & Login</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fullName">{t("fullName")}</Label>
              <Input id="fullName" name="fullName" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="internalNumber">Interne Nummer</Label>
              <Input id="internalNumber" name="internalNumber" />
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">{t("email")}</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{ta("password")}</Label>
              <PasswordField placeholder={ta("passwordHint")} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("profileSection")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
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
            <Label>{t("languages")}</Label>
            <LanguageSelect />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="skills">{t("skills")}</Label>
              <Input id="skills" name="skills" placeholder={t("skillsHint")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="certifications">{t("certifications")}</Label>
              <Input id="certifications" name="certifications" placeholder={t("certificationsHint")} />
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="yearsExperience">{t("yearsExperience")}</Label>
              <Input id="yearsExperience" name="yearsExperience" type="number" min={0} max={80} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employedSince">{t("employedSince")}</Label>
              <Input id="employedSince" name="employedSince" type="date" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bio">{t("bio")}</Label>
            <textarea id="bio" name="bio" className={textareaClass} placeholder={t("bioHint")} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("personalSection")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("contractSection") || "Vertrag & Finanzen"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="requiredHours">{t("requiredHours")}</Label>
              <Input id="requiredHours" name="requiredHours" type="number" step="0.01" min={0} max={744} defaultValue={151.67} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="carryoverHours">{t("carryoverHours")}</Label>
              <Input id="carryoverHours" name="carryoverHours" type="number" step="0.01" defaultValue={0} />
              <p className="text-xs text-muted-foreground">{t("carryoverHoursHint")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="employmentStartDate">Gültig ab (Startdatum)</Label>
              <Input id="employmentStartDate" name="employmentStartDate" type="date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employmentEndDate">Gültig bis (Enddatum)</Label>
              <Input id="employmentEndDate" name="employmentEndDate" type="date" />
              <p className="text-xs text-muted-foreground">Nur bei befristeten Verträgen erforderlich.</p>
            </div>
          </div>

          <div className="border-t pt-6 grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2 h-9">
                <input type="checkbox" id="travelAllowanceEnabled" name="travelAllowanceEnabled" className="size-4" />
                <Label htmlFor="travelAllowanceEnabled">Fahrtkosten erstatten</Label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="travelAllowancePerKm">Fahrtkosten pro km (€)</Label>
                <Input id="travelAllowancePerKm" name="travelAllowancePerKm" type="number" step="0.01" defaultValue={0.30} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 h-9">
                <input type="checkbox" id="mealAllowanceEnabled" name="mealAllowanceEnabled" className="size-4" />
                <Label htmlFor="mealAllowanceEnabled">Verpflegungsmehraufwand erstatten</Label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="mealAllowance">Spesen pro Schicht (€)</Label>
                <Input id="mealAllowance" name="mealAllowance" type="number" step="0.01" defaultValue={14.0} />
              </div>
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <Label className="text-base font-semibold">Zuschläge (%)</Label>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="surchargeSat">Samstag</Label>
                <Input id="surchargeSat" name="surchargeSat" type="number" step="1" defaultValue={0} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="surchargeSun">Sonntag</Label>
                <Input id="surchargeSun" name="surchargeSun" type="number" step="1" defaultValue={50} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="surchargeHoliday">Feiertag</Label>
                <Input id="surchargeHoliday" name="surchargeHoliday" type="number" step="1" defaultValue={100} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="surchargeNight">Nacht</Label>
                <Input id="surchargeNight" name="surchargeNight" type="number" step="1" defaultValue={25} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 mt-2">
              <div className="space-y-2">
                <Label htmlFor="nightStart">Nacht Beginn (HH:mm)</Label>
                <Input id="nightStart" name="nightStart" type="time" defaultValue="23:00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nightEnd">Nacht Ende (HH:mm)</Label>
                <Input id="nightEnd" name="nightEnd" type="time" defaultValue="06:00" />
              </div>
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <Label className="text-base font-semibold">Stundenlöhne (Standardwerte in Grau)</Label>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="ratePflegefachkraft">Pflegefachkraft (€)</Label>
                <Input id="ratePflegefachkraft" name="ratePflegefachkraft" type="number" step="0.01" placeholder="28.00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ratePflegehelfer">Pflegehelfer (€)</Label>
                <Input id="ratePflegehelfer" name="ratePflegehelfer" type="number" step="0.01" placeholder="17.00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rateBetreuungskraft">Betreuungskraft/PHK (€)</Label>
                <Input id="rateBetreuungskraft" name="rateBetreuungskraft" type="number" step="0.01" placeholder="19.00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ratePflegedienstleitung">PDL (€)</Label>
                <Input id="ratePflegedienstleitung" name="ratePflegedienstleitung" type="number" step="0.01" placeholder="32.00" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="receiveEmails"
            name="receiveEmails"
            defaultChecked={true}
            className="size-4"
          />
          <Label htmlFor="receiveEmails">E-Mail Benachrichtigungen senden</Label>
        </div>
        
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
      </div>
    </form>
  );
}
