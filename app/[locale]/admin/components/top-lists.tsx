"use client";

import { Link } from "@/i18n/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Building2, UserCircle } from "lucide-react";

interface TopClient {
  id: string;
  name: string;
  orderCount: number;
}

interface AttentionWorker {
  id: string;
  name: string;
  carryoverHours: number;
}

interface TopListsProps {
  topClients: TopClient[];
  attentionWorkers: AttentionWorker[];
}

export function TopLists({ topClients, attentionWorkers }: TopListsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            Top-Kunden (Diesen Monat)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topClients.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Daten verfügbar.</p>
          ) : (
            <ul className="space-y-4">
              {topClients.map((client) => (
                <li key={client.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-2 rounded-full">
                      <Building2 className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <Link href={`/admin/clients/${client.id}`} className="text-sm font-medium hover:underline">
                        {client.name}
                      </Link>
                    </div>
                  </div>
                  <div className="text-sm font-bold bg-muted px-2 py-1 rounded-md">
                    {client.orderCount} Schichten
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <UserCircle className="w-4 h-4 text-primary" />
            Mitarbeiter-Stundenkonto (Fokus)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {attentionWorkers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Alle Konten sind ausgeglichen.</p>
          ) : (
            <ul className="space-y-4">
              {attentionWorkers.map((worker) => (
                <li key={worker.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-2 rounded-full">
                      <UserCircle className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <Link href={`/admin/workers/${worker.id}`} className="text-sm font-medium hover:underline">
                        {worker.name}
                      </Link>
                    </div>
                  </div>
                  <div className={`text-sm font-bold px-2 py-1 rounded-md ${worker.carryoverHours < 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                    {worker.carryoverHours < 0 ? "+" : "-"}{Math.abs(worker.carryoverHours).toFixed(1)} h
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
