"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ShieldCheck,
  Lock,
  Calendar,
  AlertTriangle,
  FileCheck2,
  Copy,
  Clock,
} from "lucide-react";
import {
  previewClientApprovalAction,
  commitClientApprovalAction,
  type ApprovalPreviewResult,
} from "@/app/[locale]/admin/clients/[id]/rates/actions";
import { GERMAN_FEDERAL_STATES, GERMAN_STATE_NAMES_DE } from "@/lib/german-holidays";
import { ClientPricingEditor } from "@/components/admin/client-pricing-editor";

type ContractOption = {
  id: string;
  period: string | null;
  documentUrl: string | null;
  signedAt: string | null;
};

type SurchargePolicyItem = {
  id: string;
  policyVersion: number;
  federalState: string;
  municipality: string | null;
  districtLocality: string | null;
  surchargeSat: number;
  surchargeSun: number;
  surchargeHoliday: number;
  surchargeNight: number;
  nightStart: string;
  nightEnd: string;
  combinationRule: string;
  sourceType: string;
  sourceReference: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isFrozen: boolean;
  frozenHash: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
};

type HourlyRateVersionItem = {
  id: string;
  rateVersion: number;
  qualification: string;
  hourlyRateInCents: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceType: string;
  sourceReference: string;
  isFrozen: boolean;
  frozenHash: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
};

export type ClientRatesApprovalProps = {
  clientId: string;
  pricingUpdatedAt: string;
  initialEffectiveFrom?: string | null;
  initialEffectiveTo?: string | null;
  facilityName: string;
  hasFrameworkAgreement: boolean;
  frameworkAgreementUrl: string | null;
  contracts: ContractOption[];
  profileHourlyRates: Record<string, number | null>;
  profileSurcharges: {
    surchargeSat: number | null;
    surchargeSun: number | null;
    surchargeHoliday: number | null;
    surchargeNight: number | null;
    nightStart: string | null;
    nightEnd: string | null;
  };
  activePolicies: SurchargePolicyItem[];
  activeRateVersions: HourlyRateVersionItem[];
};

const QUALIFICATIONS_LIST = [
  "pflegefachkraft",
  "pflegehelfer",
  "betreuungskraft",
  "pflegedienstleitung",
  "kuechenhilfe",
  "hausmeister",
] as const;

export function ClientRatesApprovalContent({
  clientId,
  pricingUpdatedAt,
  initialEffectiveFrom,
  initialEffectiveTo,
  facilityName,
  profileHourlyRates,
  profileSurcharges,
  activePolicies,
  activeRateVersions,
}: ClientRatesApprovalProps) {
  const t = useTranslations("ratesApproval");
  const c = useTranslations("common");
  const eq = useTranslations("enums.qualification");
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewResult, setPreviewResult] = useState<ApprovalPreviewResult | null>(null);
  const [confirmedByUser, setConfirmedByUser] = useState(false);
  const [pending, startTransition] = useTransition();
  const [pricingDirty, setPricingDirty] = useState(false);

  // Existing client-profile values are confirmed as an administrative setting.
  // The server records the acting administrator and truthful source label.
  const sourceType = "setting" as const;
  const [effectiveFrom, setEffectiveFrom] = useState(
    initialEffectiveFrom || new Date().toISOString().slice(0, 10)
  );
  const [effectiveTo, setEffectiveTo] = useState(
    initialEffectiveTo || new Date(new Date().getFullYear(), 11, 31).toISOString().slice(0, 10)
  );

  // Surcharges Form State
  const [approveSurcharges, setApproveSurcharges] = useState(true);
  const [federalState, setFederalState] = useState<string>("");
  const [municipality, setMunicipality] = useState("");
  const [districtLocality, setDistrictLocality] = useState("");
  const [combinationRule, setCombinationRule] = useState<string>("");
  const [nightStart] = useState(
    profileSurcharges.nightStart || ""
  );
  const [nightEnd] = useState(
    profileSurcharges.nightEnd || ""
  );

  const [surchargeSatPct] = useState(
    profileSurcharges.surchargeSat !== null
      ? String(Math.round(profileSurcharges.surchargeSat * 100))
      : ""
  );
  const [surchargeSunPct] = useState(
    profileSurcharges.surchargeSun !== null
      ? String(Math.round(profileSurcharges.surchargeSun * 100))
      : ""
  );
  const [surchargeHolidayPct] = useState(
    profileSurcharges.surchargeHoliday !== null
      ? String(Math.round(profileSurcharges.surchargeHoliday * 100))
      : ""
  );
  const [surchargeNightPct] = useState(
    profileSurcharges.surchargeNight !== null
      ? String(Math.round(profileSurcharges.surchargeNight * 100))
      : ""
  );

  // Rates Form State
  const [approveRates, setApproveRates] = useState(true);
  const [selectedQualifications, setSelectedQualifications] = useState<
    Record<string, boolean>
  >(() => {
    const map: Record<string, boolean> = {};
    for (const q of QUALIFICATIONS_LIST) {
      const rate = profileHourlyRates[q];
      map[q] = typeof rate === "number" && Number.isFinite(rate) && rate > 0;
    }
    return map;
  });

  const [ratesEur] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const q of QUALIFICATIONS_LIST) {
      const v = profileHourlyRates[q];
      map[q] = v !== null && v !== undefined ? String(v) : "";
    }
    return map;
  });

  // Handle Dialog Opening & Prefill
  const handleOpenDialog = () => {
    setConfirmedByUser(false);
    setPreviewResult(null);
    setDialogOpen(true);
  };

  // Step 1: Pre-flight preview calculation
  const handleCalculatePreview = async () => {
    if (!effectiveFrom || !effectiveTo) {
      toast.error(t("validityPeriod"));
      return;
    }

    if (effectiveFrom > effectiveTo) {
      toast.error("Gültig ab darf nicht nach Gültig bis liegen.");
      return;
    }

    if (approveSurcharges) {
      if (!federalState || !combinationRule || !nightStart || !nightEnd) {
        toast.error(t("missingPolicySettings"));
        return;
      }
      for (const value of [surchargeSatPct, surchargeSunPct, surchargeHolidayPct, surchargeNightPct]) {
        if (value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 200) {
          toast.error(t("missingSurchargeValues"));
          return;
        }
      }
    }

    // Selected rates list
    const selectedRatesList: Array<{ qualification: string; hourlyRateEur: number }> = [];
    if (approveRates) {
      for (const q of QUALIFICATIONS_LIST) {
        if (selectedQualifications[q]) {
          const val = Number(ratesEur[q]);
          if (!val || val <= 0) {
            toast.error(`${eq(q)}: ${t("hourlyRateRequired")}`);
            return;
          }
          selectedRatesList.push({ qualification: q, hourlyRateEur: val });
        }
      }
      if (selectedRatesList.length === 0) {
        toast.error(t("selectQualificationToApprove"));
        return;
      }
    }

    const payload = {
      clientId,
      clientContractId: null,
      sourceType,
      sourceReference: "",
      effectiveFrom,
      effectiveTo,
      approveSurcharges,
      federalState,
      municipality: municipality.trim() || null,
      districtLocality: districtLocality.trim() || null,
      nightStart,
      nightEnd,
      combinationRule,
      surchargeSat: Number(surchargeSatPct) / 100,
      surchargeSun: Number(surchargeSunPct) / 100,
      surchargeHoliday: Number(surchargeHolidayPct) / 100,
      surchargeNight: Number(surchargeNightPct) / 100,
      zeroRateRationale: {},
      approveRates,
      selectedRates: selectedRatesList,
    };

    startTransition(async () => {
      const res = await previewClientApprovalAction(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setPreviewResult(res.data);
      setPreviewModalOpen(true);
    });
  };

  // Step 2: Commit & Freeze
  const handleCommit = async () => {
    if (!previewResult) return;
    if (!confirmedByUser) {
      toast.error(t("confirmationCheckbox"));
      return;
    }

    const expectedRateHashes: Record<string, string> = {};
    for (const rp of previewResult.ratePreviews) {
      expectedRateHashes[rp.rateTerms.qualification] = rp.integrity.canonicalHash;
    }

    const payload = {
      clientId,
      clientContractId: null,
      sourceType,
      sourceReference: "",
      effectiveFrom,
      effectiveTo,
      approveSurcharges,
      federalState,
      municipality: municipality.trim() || null,
      districtLocality: districtLocality.trim() || null,
      nightStart,
      nightEnd,
      combinationRule,
      surchargeSat: Number(surchargeSatPct) / 100,
      surchargeSun: Number(surchargeSunPct) / 100,
      surchargeHoliday: Number(surchargeHolidayPct) / 100,
      surchargeNight: Number(surchargeNightPct) / 100,
      zeroRateRationale: {},
      approveRates,
      selectedRates: previewResult.ratePreviews.map((rp) => ({
        qualification: rp.rateTerms.qualification,
        hourlyRateEur: rp.rateTerms.hourlyRateInCents / 100,
      })),
      expectedSurchargeHash: previewResult.surchargePreview?.integrity.canonicalHash ?? null,
      expectedRateHashes,
    };

    startTransition(async () => {
      const res = await commitClientApprovalAction(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("successTitle"), { description: t("successDesc") });
      setPreviewModalOpen(false);
      setDialogOpen(false);
      router.refresh();
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(c("copied") || "Kopiert");
  };

  return (
    <div className="space-y-8">
      {/* Top Banner & Action */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("title")}: {facilityName}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="space-y-1">
          <Button onClick={handleOpenDialog} disabled={pricingDirty} className="gap-2">
            <ShieldCheck className="size-4" />
            {t("openApprovalDialog")}
          </Button>
          {pricingDirty && <p className="text-xs text-muted-foreground">{t("pricingSaveBeforeApproval")}</p>}
        </div>
      </div>

      {/* Single editing location for billing values; approval below freezes versions separately. */}
      <Card>
        <CardHeader>
          <CardTitle>{t("pricingEditorTitle")}</CardTitle>
          <CardDescription>{t("pricingEditorDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ClientPricingEditor
            clientId={clientId}
            expectedUpdatedAt={pricingUpdatedAt}
            profileSurcharges={profileSurcharges}
            profileHourlyRates={profileHourlyRates}
            onDirtyChange={setPricingDirty}
          />
        </CardContent>
      </Card>

      {/* SECTION 2: Active V2 Billing Records */}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            {t("v2ActiveTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("v2ActiveDesc")}</p>
        </div>

        {/* Active Surcharge Policies */}
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">
            {t("activePolicyCardTitle")}
          </h3>
          {activePolicies.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertTriangle className="size-5 shrink-0" />
              <span>{t("noActivePolicy")}</span>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {activePolicies.map((pol) => (
                <Card key={pol.id} className="relative overflow-hidden">
                  <div className="absolute top-0 end-0 rounded-bl-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">
                    <span className="flex items-center gap-1">
                      <Lock className="size-3" />
                      {t("frozen")} (v{pol.policyVersion})
                    </span>
                  </div>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {GERMAN_STATE_NAMES_DE[pol.federalState as keyof typeof GERMAN_STATE_NAMES_DE] || pol.federalState} ({pol.federalState})
                    </CardTitle>
                    <CardDescription>
                      {pol.municipality || "—"}{pol.districtLocality ? ` (${pol.districtLocality})` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-2 border-y py-2">
                      <div>Sa: <strong>{Math.round(pol.surchargeSat * 100)} %</strong></div>
                      <div>So: <strong>{Math.round(pol.surchargeSun * 100)} %</strong></div>
                      <div>Feiertag: <strong>{Math.round(pol.surchargeHoliday * 100)} %</strong></div>
                      <div>Nacht: <strong>{Math.round(pol.surchargeNight * 100)} %</strong></div>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="size-3.5" />
                      <span>{t("nightWindow")}: {pol.nightStart}–{pol.nightEnd} ({pol.combinationRule})</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="size-3.5" />
                      <span>{t("validityPeriod")}: {pol.effectiveFrom} .. {pol.effectiveTo || "offen"}</span>
                    </div>
                    <div className="text-muted-foreground">
                      <span>{t("sourceRef")}: <strong>{pol.sourceReference}</strong></span>
                    </div>
                    {pol.frozenHash && (
                      <div className="flex items-center gap-2 rounded bg-muted p-1.5 font-mono text-[11px] text-muted-foreground">
                        <span className="truncate">{pol.frozenHash}</span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => copyToClipboard(pol.frozenHash!)}
                        >
                          <Copy className="size-3" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Active Hourly Rates */}
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-foreground">
            {t("hourlyRatesCardTitle")}
          </h3>
          {activeRateVersions.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertTriangle className="size-5 shrink-0" />
              <span>{t("noActiveRates")}</span>
            </div>
          ) : (
            <div className="divide-y rounded-xl border bg-card text-sm">
              {activeRateVersions.map((rate) => (
                <div
                  key={rate.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">
                        {eq(rate.qualification)}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        v{rate.rateVersion}
                      </Badge>
                      <Badge className="bg-emerald-600 text-white text-xs">
                        {t("frozen")}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{t("validityPeriod")}: {rate.effectiveFrom} .. {rate.effectiveTo || "offen"}</span>
                      <span>{t("sourceRef")}: {rate.sourceReference}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-end">
                    <span className="text-base font-bold text-foreground">
                      {(rate.hourlyRateInCents / 100).toFixed(2)} € / Std.
                    </span>
                    {rate.frozenHash && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={rate.frozenHash}
                        onClick={() => copyToClipboard(rate.frozenHash!)}
                      >
                        <Copy className="size-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* APPROVAL FORM DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogSubtitle")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Existing profile values are explicitly confirmed for future invoices. */}
            <div className="space-y-4 rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">{t("profileApprovalIntro")}</p>
              {initialEffectiveFrom && initialEffectiveFrom < new Date().toISOString().slice(0, 10) && (
                <p className="text-sm font-medium text-amber-700">
                  Bitte prüfen Sie mit der Buchhaltung, ob die heutigen Profilwerte bereits ab {initialEffectiveFrom} galten. Eine rückwirkende Freigabe darf nicht allein aus dem aktuellen Profil abgeleitet werden.
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <Label>{t("effectiveFrom")}</Label>
                  <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                </div>
                <div className="min-w-0 space-y-2">
                  <Label>{t("effectiveTo")}</Label>
                  <Input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
                </div>
              </div>
            </div>

            {/* 2. Surcharges & Location */}
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">
                  {t("sectionSurcharges")}
                </h4>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={approveSurcharges}
                    onChange={(e) => setApproveSurcharges(e.target.checked)}
                    className="rounded"
                  />
                  <span>{t("includeSurcharges")}</span>
                </label>
              </div>

              {approveSurcharges && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                    <span>{t("editProfilePricingHint")}</span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div className="min-w-0 space-y-2">
                      <Label>{t("federalState")}</Label>
                      <select
                        className="w-full rounded-md border bg-background p-2 text-sm"
                        value={federalState}
                        onChange={(e) => setFederalState(e.target.value)}
                      >
                        <option value="">{t("selectFederalState")}</option>
                        {GERMAN_FEDERAL_STATES.map((st) => (
                          <option key={st} value={st}>
                            {GERMAN_STATE_NAMES_DE[st]} ({st})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Label>{t("municipality")}</Label>
                      <Input
                        placeholder="z.B. Bonn"
                        value={municipality}
                        onChange={(e) => setMunicipality(e.target.value)}
                      />
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Label>{t("districtLocality")}</Label>
                      <Input
                        placeholder="Optional"
                        value={districtLocality}
                        onChange={(e) => setDistrictLocality(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div className="min-w-0 space-y-2">
                      <Label>{t("combinationRule")}</Label>
                      <select
                        className="w-full rounded-md border bg-background p-2 text-sm"
                        value={combinationRule}
                        onChange={(e) => setCombinationRule(e.target.value)}
                      >
                        <option value="">{t("selectCombinationRule")}</option>
                        <option value="highest_non_night_plus_night">{t("ruleHighest")}</option>
                        <option value="cumulative">{t("ruleCumulative")}</option>
                      </select>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Label>{t("nightStart")}</Label>
                      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{nightStart || "—"}</div>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Label>{t("nightEnd")}</Label>
                      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{nightEnd || "—"}</div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="min-w-0 space-y-2">
                      <Label>{t("surchargeSat")}</Label>
                      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{surchargeSatPct === "" ? "—" : `${surchargeSatPct} %`}</div>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Label>{t("surchargeSun")}</Label>
                      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{surchargeSunPct === "" ? "—" : `${surchargeSunPct} %`}</div>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Label>{t("surchargeHoliday")}</Label>
                      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{surchargeHolidayPct === "" ? "—" : `${surchargeHolidayPct} %`}</div>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <Label>{t("surchargeNight")}</Label>
                      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{surchargeNightPct === "" ? "—" : `${surchargeNightPct} %`}</div>
                    </div>
                  </div>

                </>
              )}
            </div>

            {/* 3. Hourly Rates */}
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-foreground">
                  {t("sectionRates")}
                </h4>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={approveRates}
                    onChange={(e) => setApproveRates(e.target.checked)}
                    className="rounded"
                  />
                  <span>{t("includeRates")}</span>
                </label>
              </div>

              {approveRates && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {t("selectQualificationToApprove")}
                  </p>
                  <div className="divide-y rounded-lg border bg-card">
                    {QUALIFICATIONS_LIST.map((q) => {
                      const isChecked = Boolean(selectedQualifications[q]);
                      return (
                        <div
                          key={q}
                          className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                setSelectedQualifications((prev) => ({
                                  ...prev,
                                  [q]: e.target.checked,
                                }));
                              }}
                              className="rounded"
                            />
                            <span className="font-medium text-sm">{eq(q)}</span>
                          </label>

                          {isChecked && (
                            <div className="flex items-center gap-2">
                              <span className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
                                {ratesEur[q] ? `${Number(ratesEur[q]).toFixed(2)} € / Std.` : t("notSet")}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleCalculatePreview} disabled={pending}>
              {pending ? t("previewing") : t("previewButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PREVIEW & COMMIT CONFIRMATION MODAL */}
      <Dialog open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
        <DialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck2 className="size-5 text-emerald-600" />
              {t("previewTitle")}
            </DialogTitle>
            <DialogDescription>{t("previewSummaryText")}</DialogDescription>
          </DialogHeader>

          {previewResult && (
            <div className="space-y-4 py-2 text-sm">
              {/* Surcharge preview */}
              {previewResult.surchargePreview && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between font-semibold">
                    <span>{t("activePolicyCardTitle")} (v{previewResult.surchargePreview.terms.policyVersion})</span>
                    <Badge variant="outline">{previewResult.surchargePreview.terms.federalState}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Sa: {Math.round(previewResult.surchargePreview.terms.surchargeSat * 100)}% |{" "}
                    So: {Math.round(previewResult.surchargePreview.terms.surchargeSun * 100)}% |{" "}
                    Feiertag: {Math.round(previewResult.surchargePreview.terms.surchargeHoliday * 100)}% |{" "}
                    Nacht: {Math.round(previewResult.surchargePreview.terms.surchargeNight * 100)}%
                  </div>
                  <div className="rounded bg-background p-2 font-mono text-[11px] break-all border">
                    <span className="font-semibold block text-muted-foreground">{t("surchargeHashLabel")}</span>
                    {previewResult.surchargePreview.integrity.canonicalHash}
                  </div>
                </div>
              )}

              {/* Rates preview */}
              {previewResult.ratePreviews.length > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  <span className="font-semibold block">{t("hourlyRatesCardTitle")}</span>
                  <div className="space-y-2">
                    {previewResult.ratePreviews.map((rp) => (
                      <div key={rp.rateTerms.qualification} className="border-t pt-2 space-y-1">
                        <div className="flex justify-between font-medium">
                          <span>{eq(rp.rateTerms.qualification)} (v{rp.rateTerms.rateVersion})</span>
                          <span>{rp.rateTerms.hourlyRateFormattedEur}</span>
                        </div>
                        <div className="rounded bg-background p-1.5 font-mono text-[10px] break-all border text-muted-foreground">
                          {rp.integrity.canonicalHash}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Confirmation Statement */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmedByUser}
                    onChange={(e) => setConfirmedByUser(e.target.checked)}
                    className="mt-1 rounded"
                  />
                  <span className="text-xs font-medium leading-relaxed">
                    {t("confirmationCheckbox")}
                  </span>
                </label>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPreviewModalOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCommit}
              disabled={!confirmedByUser || pending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {pending ? t("committing") : t("commitButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
