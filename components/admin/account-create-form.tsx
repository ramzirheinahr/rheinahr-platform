"use client";

import { useState, useTransition } from "react";
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
import {
  assignableRoles,
  qualifications,
  contractTypes,
  facilityTypes,
  locales,
} from "@/lib/validations";
import { createAccount } from "@/app/[locale]/admin/accounts/actions";

type AssignableRole = (typeof assignableRoles)[number];

export function AccountCreateForm({ initialRole }: { initialRole?: AssignableRole }) {
  const t = useTranslations("accounts");
  const c = useTranslations("common");
  const ecl = useTranslations("clients");
  const ew = useTranslations("workers");
  const er = useTranslations("enums.role");
  const eq = useTranslations("enums.qualification");
  const ec = useTranslations("enums.contractType");
  const ef = useTranslations("enums.facilityType");
  const el = useTranslations("enums.language");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<AssignableRole>(initialRole ?? "worker");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createAccount(formData);
      if (res.ok) {
        toast.success(t("created"));
        router.push("/admin/accounts");
        router.refresh();
      } else {
        const key =
          res.error === "emailInUse" || res.error === "forbidden"
            ? res.error
            : "saveError";
        toast.error(t(key));
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
          <Label>{t("role")}</Label>
          <Select
            name="role"
            value={role}
            onValueChange={(v) => setRole(v as AssignableRole)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assignableRoles.map((r) => (
                <SelectItem key={r} value={r}>
                  {er(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t("password")}</Label>
          <Input
            id="password"
            name="password"
            type="text"
            minLength={12}
            placeholder={t("passwordHint")}
            required
          />
        </div>
      </div>

      {role === "worker" && (
        <fieldset className="space-y-5 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">{t("profileSection")}</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{ew("qualification")}</Label>
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
              <Label>{ew("contractType")}</Label>
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
              <Label htmlFor="phone">{ew("phone")}</Label>
              <Input id="phone" name="phone" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="waddress">{ew("address")}</Label>
              <Input id="waddress" name="address" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="certifications">{ew("certifications")}</Label>
            <Input
              id="certifications"
              name="certifications"
              placeholder={ew("certificationsHint")}
            />
          </div>
          <div className="space-y-2">
            <Label>{ew("languages")}</Label>
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
        </fieldset>
      )}

      {role === "client" && (
        <fieldset className="space-y-5 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">{t("profileSection")}</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="facilityName">{t("facilityName")}</Label>
              <Input id="facilityName" name="facilityName" required />
            </div>
            <div className="space-y-2">
              <Label>{t("facilityType")}</Label>
              <Select name="facilityType" defaultValue={facilityTypes[0]}>
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
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contactPerson">{t("contactPerson")}</Label>
              <Input id="contactPerson" name="contactPerson" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="caddress">{ew("address")}</Label>
              <Input id="caddress" name="address" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="billingInfo">{t("billingInfo")}</Label>
            <Input id="billingInfo" name="billingInfo" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">{ecl("surcharges")}</p>
            <p className="text-xs text-muted-foreground">{ecl("surchargesHint")}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="surchargeSat">{ecl("surchargeSat")}</Label>
                <Input id="surchargeSat" name="surchargeSat" type="number" min={0} max={500} step={1} inputMode="decimal" placeholder="25" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="surchargeSun">{ecl("surchargeSun")}</Label>
                <Input id="surchargeSun" name="surchargeSun" type="number" min={0} max={500} step={1} inputMode="decimal" placeholder="50" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="surchargeHoliday">{ecl("surchargeHoliday")}</Label>
                <Input id="surchargeHoliday" name="surchargeHoliday" type="number" min={0} max={500} step={1} inputMode="decimal" placeholder="100" />
              </div>
            </div>
          </div>
        </fieldset>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? c("loading") : c("create")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/accounts")}
        >
          {c("cancel")}
        </Button>
      </div>
    </form>
  );
}
