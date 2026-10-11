"use client";

import { useState, useTransition, useId } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FileText,
  FileSignature,
  Download,
  Clock,
  User,
  AlertCircle,
  Loader2,
  Calendar,
  Building,
  CheckCircle2,
  FileWarning,
  PlusCircle,
  Check,
  X,
  History,
} from "lucide-react";
import {
  getShiftEvidenceTimelineAction,
  proposeHoursCorrectionAction,
  approveHoursCorrectionAction,
  rejectHoursCorrectionAction,
} from "@/app/[locale]/admin/workers/[id]/schedule/actions";
import type {
  EvidenceTimeline,
  EvidenceDocumentView,
  CorrectionRecordView,
} from "@/lib/confirmation-evidence-service";

interface ShiftEvidenceDialogProps {
  assignmentId: string;
  shiftDate?: string;
  facilityName?: string;
  workerName?: string;
  triggerBtn?: React.ReactNode;
  isAdmin?: boolean;
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const intlLocale = locale === "ar" ? "ar-EG" : locale === "en" ? "en-US" : "de-DE";
    return d.toLocaleString(intlLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function computePreviewNetHours(start: string, end: string, breakMins: number): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) {
    return null;
  }
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  const gross = e > s ? e - s : 1440 - s + e;
  if (gross <= 0 || breakMins < 0 || breakMins >= gross) return null;
  return Math.round(((gross - breakMins) / 60) * 100) / 100;
}

export function ShiftEvidenceDialog({
  assignmentId,
  shiftDate,
  facilityName,
  workerName,
  triggerBtn,
  isAdmin: propIsAdmin,
}: ShiftEvidenceDialogProps) {
  const t = useTranslations("confirmations");
  const c = useTranslations("common");
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [timeline, setTimeline] = useState<EvidenceTimeline | null>(null);
  const [canAdminDecide, setCanAdminDecide] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Approve dialog state
  const [approvingCorrection, setApprovingCorrection] = useState<CorrectionRecordView | null>(null);
  const [approveStartTime, setApproveStartTime] = useState("");
  const [approveEndTime, setApproveEndTime] = useState("");
  const [approveBreakMinutes, setApproveBreakMinutes] = useState("0");
  const [approveNote, setApproveNote] = useState("");
  const [approveActionError, setApproveActionError] = useState<string | null>(null);

  // Reject dialog state
  const [rejectingCorrection, setRejectingCorrection] = useState<CorrectionRecordView | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectActionError, setRejectActionError] = useState<string | null>(null);

  // Propose dialog state
  const [isProposing, setIsProposing] = useState(false);
  const [proposeDocId, setProposeDocId] = useState("");
  const [proposeHours, setProposeHours] = useState("");
  const [proposeStartTime, setProposeStartTime] = useState("");
  const [proposeEndTime, setProposeEndTime] = useState("");
  const [proposeBreakMinutes, setProposeBreakMinutes] = useState("0");
  const [proposeReason, setProposeReason] = useState("");
  const [proposeActionError, setProposeActionError] = useState<string | null>(null);

  const approveStartId = useId();
  const approveEndId = useId();
  const approveBreakId = useId();
  const approveNoteId = useId();
  const rejectNoteId = useId();
  const proposeDocSelectId = useId();
  const proposeHoursId = useId();
  const proposeStartId = useId();
  const proposeEndId = useId();
  const proposeBreakId = useId();
  const proposeReasonId = useId();

  const userCanDecide = Boolean(propIsAdmin || canAdminDecide);

  function loadEvidence() {
    setError(null);
    setSuccessMessage(null);
    startTransition(async () => {
      const res = await getShiftEvidenceTimelineAction(assignmentId);
      if (res.ok && res.timeline) {
        setTimeline(res.timeline);
        setCanAdminDecide(Boolean(res.canAdminDecide));
      } else {
        setError(res.error || t("saveError"));
      }
    });
  }

  function handleOpenChange(newOpen: boolean) {
    setOpen(newOpen);
    if (newOpen && !timeline) {
      loadEvidence();
    }
  }

  function openApproveModal(corr: CorrectionRecordView) {
    setApprovingCorrection(corr);
    setApproveStartTime(corr.proposedStartTime || timeline?.effectiveStartTime || "08:00");
    setApproveEndTime(corr.proposedEndTime || timeline?.effectiveEndTime || "16:00");
    setApproveBreakMinutes(
      corr.proposedBreakMinutes != null
        ? String(corr.proposedBreakMinutes)
        : String(timeline?.effectiveBreakMinutes ?? 30)
    );
    setApproveNote("");
    setApproveActionError(null);
  }

  function openRejectModal(corr: CorrectionRecordView) {
    setRejectingCorrection(corr);
    setRejectNote("");
    setRejectActionError(null);
  }

  function openProposeModal() {
    setIsProposing(true);
    setProposeDocId(timeline?.documents[0]?.id || "");
    setProposeHours(
      timeline?.effectiveWorkHours ? String(timeline.effectiveWorkHours) : ""
    );
    setProposeStartTime(timeline?.effectiveStartTime || "08:00");
    setProposeEndTime(timeline?.effectiveEndTime || "16:00");
    setProposeBreakMinutes(String(timeline?.effectiveBreakMinutes ?? 30));
    setProposeReason("");
    setProposeActionError(null);
  }

  function handleConfirmApprove() {
    if (!approvingCorrection) return;
    setApproveActionError(null);
    startTransition(async () => {
      const res = await approveHoursCorrectionAction({
        correctionRequestId: approvingCorrection.id,
        expectedEffectiveVersion: timeline?.effectiveVersion || "",
        effectiveStartTime: approveStartTime.trim() || undefined,
        effectiveEndTime: approveEndTime.trim() || undefined,
        effectiveBreakMinutes: approveBreakMinutes.trim()
          ? Number(approveBreakMinutes.trim())
          : undefined,
        decisionNote: approveNote.trim() || undefined,
      });

      if (res.ok) {
        setApprovingCorrection(null);
        setSuccessMessage(t("correctionApprovedSuccess"));
        loadEvidence();
      } else {
        setApproveActionError(res.error || t("saveError"));
      }
    });
  }

  function handleConfirmReject() {
    if (!rejectingCorrection) return;
    setRejectActionError(null);
    startTransition(async () => {
      const res = await rejectHoursCorrectionAction({
        correctionRequestId: rejectingCorrection.id,
        decisionNote: rejectNote.trim() || undefined,
      });

      if (res.ok) {
        setRejectingCorrection(null);
        setSuccessMessage(t("correctionRejectedSuccess"));
        loadEvidence();
      } else {
        setRejectActionError(res.error || t("saveError"));
      }
    });
  }

  function handleConfirmPropose() {
    if (!proposeDocId) {
      setProposeActionError(t("fileRequired"));
      return;
    }
    setProposeActionError(null);
    startTransition(async () => {
      const res = await proposeHoursCorrectionAction({
        assignmentId,
        documentId: proposeDocId,
        expectedEffectiveVersion: timeline?.effectiveVersion || "",
        expectedBaselineHours: timeline?.effectiveWorkHours,
        proposedHours: proposeHours.trim() ? Number(proposeHours.trim()) : undefined,
        proposedStartTime: proposeStartTime.trim() || undefined,
        proposedEndTime: proposeEndTime.trim() || undefined,
        proposedBreakMinutes: proposeBreakMinutes.trim()
          ? Number(proposeBreakMinutes.trim())
          : undefined,
        reason: proposeReason.trim() || undefined,
      });

      if (res.ok) {
        setIsProposing(false);
        setSuccessMessage(t("correctionProposedSuccess"));
        loadEvidence();
      } else {
        setProposeActionError(res.error || t("saveError"));
      }
    });
  }

  const approvePreview = computePreviewNetHours(
    approveStartTime,
    approveEndTime,
    Number(approveBreakMinutes) || 0
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger
          render={
            triggerBtn ? (
              (triggerBtn as React.ReactElement)
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                title={t("viewEvidence")}
              >
                <FileText className="size-3.5" />
                <span className="sr-only sm:not-sr-only sm:inline-block">
                  {t("viewEvidence")}
                </span>
              </Button>
            )
          }
        />

        <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full sm:max-w-2xl max-h-[85vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-start">
              <FileSignature className="size-5 text-primary" />
              {t("evidenceHistory")}
            </DialogTitle>
            <DialogDescription className="text-start">
              {t("evidenceHistoryDesc")}
            </DialogDescription>
          </DialogHeader>

          {/* Shift metadata bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-3">
              {(shiftDate || timeline?.shiftDate) && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="size-3.5 text-primary" />
                  <span className="font-medium text-foreground">
                    {shiftDate || timeline?.shiftDate}
                  </span>
                </div>
              )}
              {(facilityName || timeline?.facilityName) && (
                <div className="flex items-center gap-1.5">
                  <Building className="size-3.5 text-primary" />
                  <span>{facilityName || timeline?.facilityName}</span>
                </div>
              )}
              {(workerName || timeline?.workerName) && (
                <div className="flex items-center gap-1.5">
                  <User className="size-3.5 text-primary" />
                  <span>{workerName || timeline?.workerName}</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Effective hours display */}
              {timeline && (
                <div className="flex items-center gap-1.5">
                  {timeline.isCorrected ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1 text-xs">
                      <CheckCircle2 className="size-3" />
                      <span>
                        {t("effectiveHours")}: {timeline.effectiveWorkHours} {t("hoursUnit")}
                      </span>
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      <span>
                        {timeline.effectiveWorkHours} {t("hoursUnit")}
                      </span>
                      {timeline.effectiveSource === "service_confirmation" && (
                        <span className="ms-1 text-[10px] text-muted-foreground">
                          ({t("baselineHours")})
                        </span>
                      )}
                    </Badge>
                  )}
                </div>
              )}

              {/* Propose new correction button (Admin only) */}
              {userCanDecide && timeline && timeline.documents.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs"
                  onClick={openProposeModal}
                >
                  <PlusCircle className="size-3.5" />
                  {t("proposeCorrectionBtn")}
                </Button>
              )}
            </div>
          </div>

          {/* Success banner */}
          {successMessage && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-800">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Loading state */}
          {isPending && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="size-8 animate-spin text-primary mb-2" />
              <span className="text-sm">{t("uploading")}</span>
            </div>
          )}

          {/* Error state */}
          {!isPending && error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              <AlertCircle className="size-5 shrink-0" />
              <span>{error}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={loadEvidence}
                className="ms-auto"
              >
                {c("retry")}
              </Button>
            </div>
          )}

          {/* Content list */}
          {!isPending && !error && timeline && (
            <div className="space-y-4">
              {/* Pending Correction Banner */}
              {timeline.pendingCorrection && (
                <div className="rounded-lg border border-amber-300 bg-amber-50/80 p-3 sm:p-3.5 text-xs text-amber-900">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <FileWarning className="size-4 text-amber-600 shrink-0" />
                      {t("pendingCorrectionBadge")}
                    </div>
                    {/* Admin Action Buttons */}
                    {userCanDecide && (
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          className="h-7 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs"
                          onClick={() => openApproveModal(timeline.pendingCorrection!)}
                        >
                          <Check className="size-3.5" />
                          {t("approveCorrectionBtn")}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 px-2.5 gap-1 text-xs"
                          onClick={() => openRejectModal(timeline.pendingCorrection!)}
                        >
                          <X className="size-3.5" />
                          {t("rejectCorrectionBtn")}
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-start">
                    <div className="min-w-0 break-words">
                      <span className="text-muted-foreground">{t("correctionPrevious")}: </span>
                      <span className="font-medium">
                        {timeline.pendingCorrection.previousHoursWorked != null
                          ? `${timeline.pendingCorrection.previousHoursWorked} ${t("hoursUnit")}`
                          : "—"}
                      </span>
                    </div>
                    <div className="min-w-0 break-words">
                      <span className="text-muted-foreground">{t("correctionProposed")}: </span>
                      <span className="font-bold text-amber-700">
                        {timeline.pendingCorrection.proposedHoursWorked} {t("hoursUnit")}
                      </span>
                    </div>
                    {timeline.pendingCorrection.proposedStartTime && (
                      <div className="min-w-0 break-words">
                        <span className="text-muted-foreground">{t("startTimeLabel")}: </span>
                        <span className="font-medium">
                          {timeline.pendingCorrection.proposedStartTime}
                        </span>
                      </div>
                    )}
                    {timeline.pendingCorrection.proposedEndTime && (
                      <div className="min-w-0 break-words">
                        <span className="text-muted-foreground">{t("endTimeLabel")}: </span>
                        <span className="font-medium">
                          {timeline.pendingCorrection.proposedEndTime}
                        </span>
                      </div>
                    )}
                  </div>

                  {timeline.pendingCorrection.reason && (
                    <div className="mt-1.5 text-muted-foreground text-start break-words">
                      <span className="font-medium">{t("correctionReason")}: </span>
                      {timeline.pendingCorrection.reason}
                    </div>
                  )}
                </div>
              )}

              {/* Documents List */}
              {timeline.documents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <FileText className="size-10 stroke-1 text-muted-foreground/60 mb-2" />
                  <p className="text-sm font-medium">{t("noEvidenceAvailable")}</p>
                </div>
              ) : (
                <div className="divide-y rounded-lg border">
                  {timeline.documents.map((doc: EvidenceDocumentView, idx: number) => {
                    const isOriginal = doc.sourceType === "electronic_original";
                    const isScan = doc.isPhysicalScan;
                    const isDynamic = doc.isDynamicallyGeneratedView;
                    const isArchived = doc.isArchivedPdf;

                    const downloadUrl = isDynamic
                      ? `/api/confirmations/${assignmentId}/pdf`
                      : `/api/confirmations/${assignmentId}/document?documentId=${doc.id}`;

                    return (
                      <div
                        key={doc.id || idx}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 hover:bg-muted/30 transition-colors text-start"
                      >
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground">
                              #{idx + 1}
                            </span>

                            {/* Primary Source Badge */}
                            {isOriginal ? (
                              <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1 text-[11px]">
                                <CheckCircle2 className="size-3" />
                                {t("electronicOriginal")}
                              </Badge>
                            ) : doc.sourceType === "manual_correction" ? (
                              doc.isCorrectionApproved ? (
                                <Badge className="bg-blue-600 hover:bg-blue-600 text-white gap-1 text-[11px]">
                                  <CheckCircle2 className="size-3" />
                                  {t("approvedCorrection")}
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="border-amber-400 bg-amber-50 text-amber-700 text-[11px]"
                                >
                                  {t("pendingCorrection")}
                                </Badge>
                              )
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-sky-400 bg-sky-50 text-sky-700 text-[11px]"
                              >
                                {t("manualUpload")}
                              </Badge>
                            )}

                            {/* Artifact type badge */}
                            {isArchived && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-200"
                              >
                                {t("archivedPdf")}
                              </Badge>
                            )}
                            {isDynamic && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] bg-amber-100 text-amber-800 border border-amber-200"
                                title={t("dynamicViewHint")}
                              >
                                {t("dynamicView")}
                              </Badge>
                            )}
                            {isScan && doc.mimeType && (
                              <Badge
                                variant="outline"
                                className="text-[10px] text-muted-foreground"
                              >
                                {doc.mimeType.split("/")[1]?.toUpperCase() || t("fileBadge")}
                              </Badge>
                            )}
                          </div>

                          {/* File & Signer details */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {doc.fileName && (
                              <span
                                className="font-mono text-[11px] truncate max-w-[200px]"
                                title={doc.fileName}
                              >
                                {doc.fileName}
                              </span>
                            )}
                            {doc.fileSizeBytes != null && (
                              <span>{formatFileSize(doc.fileSizeBytes)}</span>
                            )}
                            {doc.signerName && (
                              <span className="flex items-center gap-1">
                                <User className="size-3" />
                                {doc.signerName}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" />
                              {formatDate(doc.createdAt, locale)}
                            </span>
                          </div>

                          {/* Hint for dynamically generated legacy view */}
                          {isDynamic && (
                            <p className="text-[11px] text-amber-700/90 font-medium">
                              {t("dynamicViewHint")}
                            </p>
                          )}

                          {/* Upload notes if any */}
                          {doc.metadata &&
                            typeof doc.metadata === "object" &&
                            "notes" in doc.metadata &&
                            doc.metadata.notes != null &&
                            String(doc.metadata.notes).trim() !== "" &&
                            String(doc.metadata.notes) !== "null" && (
                              <p className="text-xs italic text-muted-foreground">
                                &quot;{String(doc.metadata.notes)}&quot;
                              </p>
                            )}
                          {doc.metadata &&
                            typeof doc.metadata === "object" &&
                            "clientNotes" in doc.metadata &&
                            doc.metadata.clientNotes != null &&
                            String(doc.metadata.clientNotes).trim() !== "" &&
                            String(doc.metadata.clientNotes) !== "null" && (
                              <p className="text-xs italic text-muted-foreground">
                                &quot;{String(doc.metadata.clientNotes)}&quot;
                              </p>
                            )}
                        </div>

                        {/* Download / View Button */}
                        <div className="shrink-0">
                          <a
                            href={downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground"
                          >
                            <Download className="size-3.5" />
                            {t("viewOrDownload")}
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Corrections Audit History */}
              {timeline.corrections && timeline.corrections.length > 0 && (
                <div className="space-y-2 pt-2 text-start">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <History className="size-3.5" />
                    <span>{t("correctionsAuditHistory")}</span>
                  </div>
                  <div className="divide-y rounded-lg border bg-muted/20 text-xs">
                    {timeline.corrections.map((corr) => (
                      <div key={corr.id} className="p-2.5 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {corr.status === "approved" ? (
                              <Badge className="bg-emerald-600 text-white text-[10px]">
                                {t("statusApproved")}
                              </Badge>
                            ) : corr.status === "rejected" ? (
                              <Badge variant="destructive" className="text-[10px]">
                                {t("statusRejected")}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">
                                {t("statusProposed")}
                              </Badge>
                            )}
                            <span className="font-semibold text-foreground">
                              {corr.proposedHoursWorked} {t("hoursUnit")}
                            </span>
                            {corr.proposedStartTime && corr.proposedEndTime && (
                              <span className="text-muted-foreground">
                                ({corr.proposedStartTime} – {corr.proposedEndTime}, {corr.proposedBreakMinutes ?? 0}m)
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {formatDate(corr.decidedAt || corr.requestedAt, locale)}
                          </span>
                        </div>
                        {corr.reason && (
                          <div className="text-muted-foreground">
                            <span className="font-medium">{t("correctionReason")}: </span>
                            {corr.reason}
                          </div>
                        )}
                        {corr.decisionNote && (
                          <div className="text-muted-foreground italic">
                            <span className="font-medium not-italic">{t("decisionNoteLabel")}: </span>
                            {corr.decisionNote}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Approve Modal */}
      <Dialog
        open={Boolean(approvingCorrection)}
        onOpenChange={(o) => {
          if (!o) setApprovingCorrection(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-start">{t("approveModalTitle")}</DialogTitle>
            <DialogDescription className="text-start">
              {t("approveModalDesc")}
            </DialogDescription>
          </DialogHeader>

          {approveActionError && (
            <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
              <AlertCircle className="size-4 shrink-0" />
              <span>{approveActionError}</span>
            </div>
          )}

          <div className="space-y-3 py-2 text-start">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={approveStartId} className="text-xs">
                  {t("startTimeLabel")}
                </Label>
                <Input
                  id={approveStartId}
                  value={approveStartTime}
                  onChange={(e) => setApproveStartTime(e.target.value)}
                  placeholder="08:00"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={approveEndId} className="text-xs">
                  {t("endTimeLabel")}
                </Label>
                <Input
                  id={approveEndId}
                  value={approveEndTime}
                  onChange={(e) => setApproveEndTime(e.target.value)}
                  placeholder="16:00"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={approveBreakId} className="text-xs">
                  {t("breakMinutesLabel")}
                </Label>
                <Input
                  id={approveBreakId}
                  type="number"
                  min="0"
                  max="720"
                  value={approveBreakMinutes}
                  onChange={(e) => setApproveBreakMinutes(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {t("calculatedNetHours")}
                </Label>
                <div className="flex h-8 items-center rounded-md border bg-muted/40 px-3 text-xs font-semibold">
                  {approvePreview != null
                    ? `${approvePreview} ${t("hoursUnit")}`
                    : "—"}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor={approveNoteId} className="text-xs">
                {t("decisionNoteLabel")}
              </Label>
              <Textarea
                id={approveNoteId}
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
                placeholder={t("decisionNotePlaceholder")}
                className="text-xs h-16 resize-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setApprovingCorrection(null)}
              disabled={isPending}
            >
              {c("cancel")}
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleConfirmApprove}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              {t("confirmApprovalBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Modal */}
      <Dialog
        open={Boolean(rejectingCorrection)}
        onOpenChange={(o) => {
          if (!o) setRejectingCorrection(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-start">{t("rejectModalTitle")}</DialogTitle>
            <DialogDescription className="text-start">
              {t("rejectModalDesc")}
            </DialogDescription>
          </DialogHeader>

          {rejectActionError && (
            <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
              <AlertCircle className="size-4 shrink-0" />
              <span>{rejectActionError}</span>
            </div>
          )}

          <div className="space-y-3 py-2 text-start">
            <div className="space-y-1">
              <Label htmlFor={rejectNoteId} className="text-xs">
                {t("decisionNoteLabel")}
              </Label>
              <Textarea
                id={rejectNoteId}
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder={t("decisionNotePlaceholder")}
                className="text-xs h-20 resize-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRejectingCorrection(null)}
              disabled={isPending}
            >
              {c("cancel")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleConfirmReject}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              {t("confirmRejectionBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Propose Modal */}
      <Dialog
        open={isProposing}
        onOpenChange={(o) => {
          if (!o) setIsProposing(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-start">{t("proposeModalTitle")}</DialogTitle>
            <DialogDescription className="text-start">
              {t("proposeModalDesc")}
            </DialogDescription>
          </DialogHeader>

          {proposeActionError && (
            <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
              <AlertCircle className="size-4 shrink-0" />
              <span>{proposeActionError}</span>
            </div>
          )}

          <div className="space-y-3 py-2 text-start">
            <div className="space-y-1">
              <Label htmlFor={proposeDocSelectId} className="text-xs">
                {t("selectSupportingDoc")}
              </Label>
              <select
                id={proposeDocSelectId}
                value={proposeDocId}
                onChange={(e) => setProposeDocId(e.target.value)}
                className="w-full h-8 rounded-md border border-input bg-background px-3 text-xs shadow-sm"
              >
                <option value="" disabled>
                  {t("selectDocPlaceholder")}
                </option>
                {timeline?.documents.map((d, i) => (
                  <option key={d.id} value={d.id}>
                    #{i + 1} - {d.fileName || d.sourceType}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={proposeHoursId} className="text-xs">
                  {t("newHours")}
                </Label>
                <Input
                  id={proposeHoursId}
                  value={proposeHours}
                  onChange={(e) => setProposeHours(e.target.value)}
                  placeholder="6.72"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={proposeBreakId} className="text-xs">
                  {t("breakMinutesLabel")}
                </Label>
                <Input
                  id={proposeBreakId}
                  type="number"
                  min="0"
                  max="720"
                  value={proposeBreakMinutes}
                  onChange={(e) => setProposeBreakMinutes(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor={proposeStartId} className="text-xs">
                  {t("startTimeLabel")}
                </Label>
                <Input
                  id={proposeStartId}
                  value={proposeStartTime}
                  onChange={(e) => setProposeStartTime(e.target.value)}
                  placeholder="08:00"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={proposeEndId} className="text-xs">
                  {t("endTimeLabel")}
                </Label>
                <Input
                  id={proposeEndId}
                  value={proposeEndTime}
                  onChange={(e) => setProposeEndTime(e.target.value)}
                  placeholder="15:13"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor={proposeReasonId} className="text-xs">
                {t("correctionReason")}
              </Label>
              <Textarea
                id={proposeReasonId}
                value={proposeReason}
                onChange={(e) => setProposeReason(e.target.value)}
                placeholder={t("notesPlaceholder")}
                className="text-xs h-16 resize-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsProposing(false)}
              disabled={isPending}
            >
              {c("cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmPropose}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
              {t("proposeCorrectionBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
