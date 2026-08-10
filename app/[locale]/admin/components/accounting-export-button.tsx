"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

export function AccountingExportButton({ month }: { month: string }) {
  const [isLoading, setIsLoading] = useState(false);
  const t = useTranslations("portal");

  const handleExport = async () => {
    try {
      setIsLoading(true);
      const [year, m] = month.split("-");
      const res = await fetch(`/api/exports/accounting?year=${year}&month=${m}`);
      
      if (!res.ok) {
        throw new Error("Export failed");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Buchhaltung_${month}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error("Failed to export accounting CSV:", error);
      alert(t("accountingExportError"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button onClick={handleExport} disabled={isLoading} variant="outline" className="gap-2">
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {t("accountingExport")}
    </Button>
  );
}
