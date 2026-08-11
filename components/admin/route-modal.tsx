"use client";

import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function RouteModal({ children, title }: { children: React.ReactNode; title?: string }) {
  const router = useRouter();

  function onOpenChange(open: boolean) {
    if (!open) {
      router.back();
    }
  }

  return (
    <Dialog defaultOpen onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl lg:max-w-4xl max-h-[90vh] overflow-y-auto w-[95vw]">
        {title && (
          <DialogTitle className="sr-only">
            {title}
          </DialogTitle>
        )}
        <DialogDescription className="sr-only">
          Modaler Dialog
        </DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
