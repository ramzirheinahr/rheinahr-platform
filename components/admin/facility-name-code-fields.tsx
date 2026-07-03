"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { suggestShortCode } from "@/lib/master-schedule-core";

// Facility name + Dienstplan-Kürzel inputs, shared by create/edit. As the
// admin types the name, the code is auto-suggested from the first letter of
// each word (e.g. "Newcare Home" → "NH") — but only until the admin edits the
// code themselves, after which their value is left untouched.
export function FacilityNameCodeFields({
  defaultName = "",
  defaultCode = "",
}: {
  defaultName?: string;
  defaultCode?: string;
}) {
  const t = useTranslations("clients");
  const [name, setName] = useState(defaultName);
  const [code, setCode] = useState(defaultCode);
  // Once the admin types in the code field we stop auto-filling it.
  const [codeTouched, setCodeTouched] = useState(defaultCode !== "");

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="facilityName">{t("facilityName")}</Label>
        <Input
          id="facilityName"
          name="facilityName"
          required
          value={name}
          onChange={(e) => {
            const v = e.target.value;
            setName(v);
            if (!codeTouched) setCode(suggestShortCode(v));
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="shortCode">{t("shortCode")}</Label>
        <Input
          id="shortCode"
          name="shortCode"
          maxLength={3}
          placeholder="NH"
          className="uppercase sm:max-w-28"
          value={code}
          onChange={(e) => {
            setCodeTouched(true);
            setCode(e.target.value.toUpperCase());
          }}
        />
        <p className="text-xs text-muted-foreground">{t("shortCodeHint")}</p>
      </div>
    </>
  );
}
