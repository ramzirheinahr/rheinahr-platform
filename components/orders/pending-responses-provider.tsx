"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { respondAssignmentsBulk } from "@/app/[locale]/worker/assignments/actions";
import { Save } from "lucide-react";

type PendingResponsesCtx = {
  pendingResponses: Record<string, boolean>;
  setPendingResponse: (id: string, accept: boolean) => void;
};

const Ctx = createContext<PendingResponsesCtx | null>(null);

export function usePendingResponses() {
  return useContext(Ctx);
}

export function PendingResponsesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pendingResponses, setPendingResponses] = useState<Record<string, boolean>>({});
  const [bulkPending, startBulkTransition] = useTransition();

  const setPendingResponse = (id: string, accept: boolean) => {
    setPendingResponses((prev) => ({ ...prev, [id]: accept }));
  };

  const saveBulkResponses = () => {
    const responses = Object.entries(pendingResponses).map(([id, accept]) => ({ id, accept }));
    if (responses.length === 0) return;
    
    startBulkTransition(async () => {
      const res = await respondAssignmentsBulk(responses);
      if (res.ok) {
        toast.success("Gespeichert");
        setPendingResponses({});
        router.refresh();
      } else {
        toast.error("Fehler beim Speichern");
        setPendingResponses({});
        router.refresh();
      }
    });
  };

  return (
    <Ctx.Provider value={{ pendingResponses, setPendingResponse }}>
      {children}
      
      {Object.keys(pendingResponses).length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-full bg-primary text-primary-foreground px-4 py-3 shadow-xl flex items-center gap-4 animate-in slide-in-from-bottom-5">
          <div className="text-sm font-medium whitespace-nowrap">
            {Object.keys(pendingResponses).length} Änderungen ausgewählt
          </div>
          <Button 
            onClick={saveBulkResponses} 
            disabled={bulkPending} 
            size="sm" 
            variant="secondary"
            className="gap-2"
          >
            <Save className="size-4" />
            {bulkPending ? "Wird gespeichert..." : "Speichern"}
          </Button>
        </div>
      )}
    </Ctx.Provider>
  );
}
