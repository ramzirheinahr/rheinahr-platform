"use client";

import { Link } from "@/i18n/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AlertCircle, Clock, FileWarning, ShieldAlert } from "lucide-react";

interface ActionItemsProps {
  pendingConfirmations: number;
  pendingLeaves: number;
  unverifiedDocs: number;
  pendingContracts: number;
}

export function ActionItems({
  pendingConfirmations,
  pendingLeaves,
  unverifiedDocs,
  pendingContracts,
}: ActionItemsProps) {
  const totalItems = pendingConfirmations + pendingLeaves + unverifiedDocs + pendingContracts;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-500" />
          Benötigt Aufmerksamkeit (Action Items)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {totalItems === 0 ? (
          <div className="flex flex-col items-center justify-center text-muted-foreground py-8">
            <ShieldAlert className="w-8 h-8 mb-2 text-green-500/50" />
            <p>Alles erledigt! Keine offenen Aufgaben.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {pendingConfirmations > 0 && (
              <li>
                <Link href="/admin/orders?status=completed" className="flex items-center gap-3 p-3 rounded-lg border bg-orange-50/50 hover:bg-orange-50 transition-colors dark:bg-orange-950/10 dark:hover:bg-orange-950/20 dark:border-orange-900/30">
                  <div className="bg-orange-100 p-2 rounded-full dark:bg-orange-900/50">
                    <Clock className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Offene Bestätigungen</p>
                    <p className="text-xs text-muted-foreground">{pendingConfirmations} Schicht(en) warten auf Stundenbestätigung</p>
                  </div>
                </Link>
              </li>
            )}
            {pendingLeaves > 0 && (
              <li>
                <Link href="/admin/leave" className="flex items-center gap-3 p-3 rounded-lg border bg-blue-50/50 hover:bg-blue-50 transition-colors dark:bg-blue-950/10 dark:hover:bg-blue-950/20 dark:border-blue-900/30">
                  <div className="bg-blue-100 p-2 rounded-full dark:bg-blue-900/50">
                    <FileWarning className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Urlaubsanträge</p>
                    <p className="text-xs text-muted-foreground">{pendingLeaves} Antrag(e) müssen geprüft werden</p>
                  </div>
                </Link>
              </li>
            )}
            {unverifiedDocs > 0 && (
              <li>
                <Link href="/admin/workers" className="flex items-center gap-3 p-3 rounded-lg border bg-yellow-50/50 hover:bg-yellow-50 transition-colors dark:bg-yellow-950/10 dark:hover:bg-yellow-950/20 dark:border-yellow-900/30">
                  <div className="bg-yellow-100 p-2 rounded-full dark:bg-yellow-900/50">
                    <FileWarning className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Ungeprüfte Dokumente</p>
                    <p className="text-xs text-muted-foreground">{unverifiedDocs} Mitarbeiter-Dokument(e) zur Prüfung</p>
                  </div>
                </Link>
              </li>
            )}
            {pendingContracts > 0 && (
              <li>
                <Link href="/admin/clients" className="flex items-center gap-3 p-3 rounded-lg border bg-purple-50/50 hover:bg-purple-50 transition-colors dark:bg-purple-950/10 dark:hover:bg-purple-950/20 dark:border-purple-900/30">
                  <div className="bg-purple-100 p-2 rounded-full dark:bg-purple-900/50">
                    <FileWarning className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Offene Verträge</p>
                    <p className="text-xs text-muted-foreground">{pendingContracts} Kundenvertrag(e) stehen aus</p>
                  </div>
                </Link>
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
