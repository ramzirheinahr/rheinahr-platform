"use client";

import { useTransition, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { qualifications, contractTypes, employmentTypes } from "@/lib/validations";
import { LanguageSelect } from "@/components/admin/language-select";
import { NationalitySelect } from "@/components/admin/nationality-select";
import { updateWorker } from "@/app/[locale]/admin/workers/actions";
import { SollHoursManager } from "@/components/admin/soll-hours-manager";

export type WorkerData = {
  id: string;
  fullName: string;
  internalNumber?: string | null;
  qualification: string;
  contractType: string;
  employmentType: string;
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
  requiredHours: number;
  sollHoursHistory?: { id: string; validFrom: string; weeklyHours: number; monthlyHours: number; }[];
  carryoverHours: number;
  deploymentRadius: number;
  travelAllowanceEnabled?: boolean;
  travelAllowancePerKm?: number | null;
  mealAllowanceType?: string;
  mealAllowance?: number | null;
  surchargeSat?: number | null;
  surchargeSun?: number | null;
  surchargeHoliday?: number | null;
  surchargeNight?: number | null;
  nightStart?: string | null;
  nightEnd?: string | null;
  hourlyRates?: Record<string, number> | null;
  employmentStartDate?: string | null;
  employmentEndDate?: string | null;
  weeklyHours?: number | null;
  monthlySalary?: number | null;
  entgeltgruppe?: string | null;
  user: {
    receiveEmails: boolean;
  };
};

const textareaClass =
  "flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function WorkerForm({ worker, customQualifications = [] }: { worker: WorkerData; customQualifications?: string[] }) {
  const t = useTranslations("workers");
  const c = useTranslations("common");
  const eq = useTranslations("enums.qualification");
  const ec = useTranslations("enums.contractType");
  const ee = useTranslations("enums.employmentType");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [initialWorker] = useState(worker);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const promise = updateWorker(worker.id, formData).then((res) => {
      if (res.ok) {
        startTransition(() => {
          router.refresh();
        });
        return res;
      }
      throw new Error("Save error");
    });

    toast.promise(promise, {
      loading: c("loading") || "Speichern...",
      success: t("updated"),
      error: t("saveError"),
    });

    router.back();
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-8 pb-10">
      
      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle>Profil</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="fullName">{t("fullName")}</Label>
              <Input id="fullName" name="fullName" required defaultValue={initialWorker.fullName} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="internalNumber">Interne Nummer</Label>
              <Input id="internalNumber" name="internalNumber" defaultValue={initialWorker.internalNumber || ""} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle>{t("profileSection")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("qualification")}</Label>
              <Combobox
                name="qualification"
                defaultValue={[initialWorker.qualification]}
                options={[
                  ...qualifications.map((q) => ({ value: q, label: eq(q) })),
                  ...customQualifications.map((q) => ({ value: q, label: q })),
                ]}
                allowCreate
                placeholder={t("qualification")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("contractType")}</Label>
              <Select name="contractType" defaultValue={initialWorker.contractType}>
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
            <div className="space-y-2">
              <Label>{t("employmentType")}</Label>
              <Select name="employmentType" defaultValue={initialWorker.employmentType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {employmentTypes.map((et) => (
                    <SelectItem key={et} value={et}>
                      {ee(et)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">{t("phone")}</Label>
            <Input id="phone" name="phone" defaultValue={initialWorker.phone ?? ""} className="sm:max-w-sm" />
          </div>

          <fieldset className="space-y-3 rounded-lg border p-4 mt-5">
            <legend className="px-1 text-sm font-medium">{t("address")}</legend>
            <div className="space-y-2 mt-2">
              <Textarea id="address" name="address" defaultValue={initialWorker.address ?? ""} rows={3} />
            </div>
          </fieldset>
          <div className="space-y-2">
            <Label>{t("languages")}</Label>
            <LanguageSelect defaultValue={initialWorker.languages} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="skills">{t("skills")}</Label>
              <Input
                id="skills"
                name="skills"
                placeholder={t("skillsHint")}
                defaultValue={initialWorker.skills.join(", ")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="certifications">{t("certifications")}</Label>
              <Input
                id="certifications"
                name="certifications"
                placeholder={t("certificationsHint")}
                defaultValue={initialWorker.certifications.join(", ")}
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
              defaultValue={initialWorker.bio ?? ""}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle>{t("personalSection")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="birthDate">{t("birthDate")}</Label>
              <Input
                id="birthDate"
                name="birthDate"
                type="date"
                defaultValue={initialWorker.birthDate ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birthPlace">{t("birthPlace")}</Label>
              <Input
                id="birthPlace"
                name="birthPlace"
                defaultValue={initialWorker.birthPlace ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("nationality")}</Label>
              <NationalitySelect defaultValue={initialWorker.nationality} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="socialSecurityNumber">{t("socialSecurityNumber")}</Label>
              <Input
                id="socialSecurityNumber"
                name="socialSecurityNumber"
                defaultValue={initialWorker.socialSecurityNumber ?? ""}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle>{t("contractSection") || "Vertrag & Finanzen"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="yearsExperience">{t("yearsExperience")}</Label>
              <Input
                id="yearsExperience"
                name="yearsExperience"
                type="number"
                min={0}
                max={80}
                defaultValue={initialWorker.yearsExperience ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employedSince">{t("employedSince")}</Label>
              <Input
                id="employedSince"
                name="employedSince"
                type="date"
                defaultValue={initialWorker.employedSince ?? ""}
              />
            </div>
          </div>
          
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="requiredHours">{t("requiredHours")}</Label>
                <SollHoursManager workerId={worker.id} history={worker.sollHoursHistory ?? []} />
              </div>
              <Input
                id="requiredHours"
                name="requiredHours"
                type="number"
                step="0.01"
                min={0}
                max={744}
                defaultValue={initialWorker.requiredHours ?? 151.67}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="weeklyHours">Wöchentliche Arbeitszeit</Label>
              <Input
                id="weeklyHours"
                name="weeklyHours"
                type="number"
                step="0.01"
                min={0}
                max={168}
                defaultValue={initialWorker.weeklyHours ?? 35}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="monthlySalary">Monatsgehalt (€)</Label>
              <Input
                id="monthlySalary"
                name="monthlySalary"
                type="number"
                step="0.01"
                min={0}
                defaultValue={initialWorker.monthlySalary ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entgeltgruppe">Entgeltgruppe</Label>
              <Input
                id="entgeltgruppe"
                name="entgeltgruppe"
                defaultValue={initialWorker.entgeltgruppe ?? ""}
                placeholder="z.B. 2a"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="carryoverHours">{t("carryoverHours")}</Label>
              <Input
                id="carryoverHours"
                name="carryoverHours"
                type="number"
                step="0.01"
                defaultValue={initialWorker.carryoverHours ?? 0}
              />
              <p className="text-xs text-muted-foreground">{t("carryoverHoursHint")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="deploymentRadius">{t("deploymentRadius")}</Label>
              <Input
                id="deploymentRadius"
                name="deploymentRadius"
                type="number"
                step="1"
                min={0}
                defaultValue={initialWorker.deploymentRadius ?? 100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employmentStartDate">Gültig ab (Startdatum)</Label>
              <Input
                id="employmentStartDate"
                name="employmentStartDate"
                type="date"
                defaultValue={initialWorker.employmentStartDate || undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="employmentEndDate">Gültig bis (Enddatum)</Label>
              <Input
                id="employmentEndDate"
                name="employmentEndDate"
                type="date"
                defaultValue={initialWorker.employmentEndDate || undefined}
              />
              <p className="text-xs text-muted-foreground">Nur bei befristeten Verträgen erforderlich.</p>
            </div>
          </div>

          <div className="border-t pt-6 grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2 h-9">
                <input
                  type="checkbox"
                  id="travelAllowanceEnabled"
                  name="travelAllowanceEnabled"
                  defaultChecked={initialWorker.travelAllowanceEnabled}
                  className="size-4"
                />
                <Label htmlFor="travelAllowanceEnabled">Fahrtkosten erstatten</Label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="travelAllowancePerKm">Fahrtkosten pro km (€)</Label>
                <Input
                  id="travelAllowancePerKm"
                  name="travelAllowancePerKm"
                  type="number"
                  step="0.01"
                  defaultValue={initialWorker.travelAllowancePerKm ?? 0.30}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="space-y-2">
                <Label htmlFor="mealAllowanceType">{t("mealAllowanceType")}</Label>
                <select
                  id="mealAllowanceType"
                  name="mealAllowanceType"
                  defaultValue={initialWorker.mealAllowanceType ?? "multiple_shifts_only"}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="per_shift">{t("mealAllowance_per_shift")}</option>
                  <option value="multiple_shifts_only">{t("mealAllowance_multiple_shifts_only")}</option>
                  <option value="none">{t("mealAllowance_none")}</option>
                </select>
              </div>
              <div className="space-y-2 mt-4">
                <Label htmlFor="mealAllowance">Spesen pro Schicht (€)</Label>
                <Input
                  id="mealAllowance"
                  name="mealAllowance"
                  type="number"
                  step="0.01"
                  defaultValue={initialWorker.mealAllowance ?? 14.0}
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <Label className="text-base font-semibold">Zuschläge (%)</Label>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="surchargeSat">Samstag</Label>
                <Input
                  id="surchargeSat"
                  name="surchargeSat"
                  type="number"
                  step="1"
                  defaultValue={initialWorker.surchargeSat != null ? initialWorker.surchargeSat * 100 : 0}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="surchargeSun">Sonntag</Label>
                <Input
                  id="surchargeSun"
                  name="surchargeSun"
                  type="number"
                  step="1"
                  defaultValue={initialWorker.surchargeSun != null ? initialWorker.surchargeSun * 100 : 50}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="surchargeHoliday">Feiertag</Label>
                <Input
                  id="surchargeHoliday"
                  name="surchargeHoliday"
                  type="number"
                  step="1"
                  defaultValue={initialWorker.surchargeHoliday != null ? initialWorker.surchargeHoliday * 100 : 100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="surchargeNight">Nacht</Label>
                <Input
                  id="surchargeNight"
                  name="surchargeNight"
                  type="number"
                  step="1"
                  defaultValue={initialWorker.surchargeNight != null ? initialWorker.surchargeNight * 100 : 25}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 mt-2">
              <div className="space-y-2">
                <Label htmlFor="nightStart">Nacht Beginn (HH:mm)</Label>
                <Input
                  id="nightStart"
                  name="nightStart"
                  type="time"
                  defaultValue={initialWorker.nightStart ?? "23:00"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nightEnd">Nacht Ende (HH:mm)</Label>
                <Input
                  id="nightEnd"
                  name="nightEnd"
                  type="time"
                  defaultValue={initialWorker.nightEnd ?? "06:00"}
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <Label className="text-base font-semibold">Stundenlöhne (Standardwerte in Grau)</Label>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="ratePflegefachkraft">Pflegefachkraft (€)</Label>
                <Input
                  id="ratePflegefachkraft"
                  name="ratePflegefachkraft"
                  type="number"
                  step="0.01"
                  placeholder="28.00"
                  defaultValue={initialWorker.hourlyRates?.pflegefachkraft}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ratePflegehelfer">Pflegehelfer (€)</Label>
                <Input
                  id="ratePflegehelfer"
                  name="ratePflegehelfer"
                  type="number"
                  step="0.01"
                  placeholder="17.00"
                  defaultValue={initialWorker.hourlyRates?.pflegehelfer}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rateBetreuungskraft">Betreuungskraft/PHK (€)</Label>
                <Input
                  id="rateBetreuungskraft"
                  name="rateBetreuungskraft"
                  type="number"
                  step="0.01"
                  placeholder="19.00"
                  defaultValue={initialWorker.hourlyRates?.betreuungskraft}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ratePflegedienstleitung">PDL (€)</Label>
                <Input
                  id="ratePflegedienstleitung"
                  name="ratePflegedienstleitung"
                  type="number"
                  step="0.01"
                  placeholder="32.00"
                  defaultValue={initialWorker.hourlyRates?.pflegedienstleitung}
                />
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
            defaultChecked={initialWorker.user?.receiveEmails ?? true}
            className="size-4"
          />
          <Label htmlFor="receiveEmails">E-Mail Benachrichtigungen senden</Label>
        </div>

        <div className="flex gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? c("loading") : c("save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            {c("cancel")}
          </Button>
        </div>
      </div>
    </form>
  );
}
