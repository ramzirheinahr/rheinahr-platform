import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Shown by route-segment loading.tsx during navigation (React Suspense),
// giving instant feedback while dynamic pages fetch data.
export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex min-h-[50vh] items-center justify-center", className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
