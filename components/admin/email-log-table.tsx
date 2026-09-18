"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import {
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Paperclip,
  Eye,
  RotateCw,
} from "lucide-react";
import {
  EmailPreviewModal,
  type OutgoingEmailItem,
} from "@/components/admin/email-preview-modal";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function EmailLogTable({ rows }: { rows: OutgoingEmailItem[] }) {
  const t = useTranslations("emails");
  const c = useTranslations("common");

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedEmail, setSelectedEmail] = useState<OutgoingEmailItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) {
        return false;
      }
      if (!query.trim()) return true;

      const q = normalize(query);
      const hay = normalize(
        `${r.to} ${r.recipientName || ""} ${r.subject} ${r.body} ${r.error || ""}`
      );
      return hay.includes(q);
    });
  }, [rows, query, statusFilter]);

  function handleOpenPreview(email: OutgoingEmailItem) {
    setSelectedEmail(email);
    setModalOpen(true);
  }

  const columns: Column<OutgoingEmailItem>[] = [
    {
      id: "date",
      header: t("date"),
      cell: (r) => {
        const d = new Date(r.sentAt || r.createdAt);
        return (
          <div className="flex flex-col text-xs">
            <span className="font-medium text-foreground">
              {d.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}
            </span>
            <span className="text-muted-foreground">
              {d.toLocaleTimeString("de-DE", {
                timeZone: "Europe/Berlin",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
        );
      },
      className: "w-[120px]",
    },
    {
      id: "recipient",
      primary: true,
      header: t("recipient"),
      cell: (r) => (
        <div className="flex flex-col max-w-[220px]">
          {r.recipientName ? (
            <>
              <span className="font-medium text-sm text-foreground truncate">
                {r.recipientName}
              </span>
              <span className="text-xs text-muted-foreground font-mono truncate">
                {r.to}
              </span>
            </>
          ) : (
            <span className="font-medium text-sm font-mono truncate">{r.to}</span>
          )}
        </div>
      ),
    },
    {
      id: "subject",
      header: t("subject"),
      cell: (r) => (
        <div className="flex flex-col max-w-[340px]">
          <span className="font-medium text-sm text-foreground truncate" title={r.subject}>
            {r.subject}
          </span>
          <span className="text-xs text-muted-foreground truncate" title={r.body}>
            {r.body.slice(0, 100)}
          </span>
        </div>
      ),
    },
    {
      id: "status",
      header: t("status"),
      cell: (r) => {
        switch (r.status) {
          case "sent":
            return (
              <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1 py-0.5 text-xs">
                <CheckCircle2 className="size-3" />
                {t("statusSent")}
              </Badge>
            );
          case "failed":
            return (
              <Badge variant="destructive" className="gap-1 py-0.5 text-xs" title={r.error || undefined}>
                <XCircle className="size-3" />
                {t("statusFailed")}
              </Badge>
            );
          case "skipped_preference":
            return (
              <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400 gap-1 py-0.5 text-xs" title={r.error || undefined}>
                <AlertTriangle className="size-3" />
                {t("statusSkipped")}
              </Badge>
            );
        }
      },
      className: "w-[130px]",
    },
    {
      id: "attachments",
      header: t("attachments"),
      cell: (r) => {
        const count = r.attachments?.length || 0;
        if (count === 0) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <Badge variant="secondary" className="gap-1 text-xs py-0.5" title={r.attachments?.map((a) => a.filename).join(", ")}>
            <Paperclip className="size-3" />
            <span>{count}</span>
          </Badge>
        );
      },
      className: "w-[90px] text-center",
    },
    {
      id: "actions",
      action: true,
      header: "",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleOpenPreview(r)}
            className="gap-1 text-primary hover:text-primary"
            title={t("viewAction")}
            aria-label={t("viewAction")}
          >
            <Eye className="size-4" />
            <span className="hidden sm:inline">{t("viewAction")}</span>
          </Button>
        </div>
      ),
      className: "w-[110px] text-end",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm w-full">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="ps-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 self-stretch sm:self-auto">
          {[
            { id: "all", label: t("filterAll") },
            { id: "sent", label: t("filterSent") },
            { id: "failed", label: t("filterFailed") },
            { id: "skipped_preference", label: t("filterSkipped") },
          ].map((f) => (
            <Button
              key={f.id}
              type="button"
              size="sm"
              variant={statusFilter === f.id ? "default" : "outline"}
              onClick={() => setStatusFilter(f.id)}
              className="text-xs h-8"
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <ResponsiveTable
        columns={columns}
        rows={filtered}
        getRowKey={(r) => r.id}
        empty={t("emptyState")}
      />

      {/* Preview Modal */}
      <EmailPreviewModal
        email={selectedEmail}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </div>
  );
}
