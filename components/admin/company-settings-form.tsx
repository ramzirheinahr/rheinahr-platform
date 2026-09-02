"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { updateSystemSetting } from "@/app/[locale]/admin/settings/system/actions";

const COMPANY_FIELDS = [
  { key: "company.name", label: "Company Name", type: "text" },
  { key: "company.shortName", label: "Short Name", type: "text" },
  { key: "company.email", label: "Email", type: "email" },
  { key: "company.phone", label: "Phone", type: "text" },
  { key: "company.fax", label: "Fax", type: "text" },
  { key: "company.mobile", label: "Mobile", type: "text" },
  { key: "company.website", label: "Website", type: "text" },
  { key: "company.websiteUrl", label: "Website URL", type: "url" },
  { key: "company.street", label: "Street", type: "text" },
  { key: "company.city", label: "City", type: "text" },
  { key: "company.ceo", label: "CEO", type: "text" },
  { key: "company.registryCourt", label: "Registry Court", type: "text" },
  { key: "company.hrb", label: "HRB", type: "text" },
  { key: "company.taxId", label: "Tax ID", type: "text" },
  { key: "company.vatId", label: "VAT ID", type: "text" },
  { key: "company.bankName", label: "Bank Name", type: "text" },
  { key: "company.iban", label: "IBAN", type: "text" },
  { key: "company.bic", label: "BIC", type: "text" },
];

export function CompanySettingsForm({ settings }: { settings: Record<string, string> }) {
  const [formData, setFormData] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    COMPANY_FIELDS.forEach((f) => {
      init[f.key] = settings[f.key] || "";
    });
    return init;
  });
  const [pending, start] = useTransition();

  function handleChange(key: string, value: string) {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    start(async () => {
      try {
        for (const f of COMPANY_FIELDS) {
          const val = formData[f.key] || "";
          if (val !== (settings[f.key] || "")) {
            await updateSystemSetting(f.key, val);
          }
        }
        toast.success("Company settings saved successfully!");
      } catch (err: any) {
        toast.error("Failed to save settings: " + err.message);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company Configuration</CardTitle>
        <CardDescription>
          Update company details used in PDFs, emails, and the website.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {COMPANY_FIELDS.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={field.key}>{field.label}</Label>
              <Input
                id={field.key}
                type={field.type}
                value={formData[field.key]}
                onChange={(e) => handleChange(field.key, e.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="pt-4 flex justify-end">
          <Button onClick={handleSave} disabled={pending}>
            {pending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
