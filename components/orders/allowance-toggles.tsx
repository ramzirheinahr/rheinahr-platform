"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Utensils, Car } from "lucide-react";
import { 
  toggleAssignmentMealAllowance, 
  toggleExcludeMealAllowance,
  toggleExcludeTravelAllowance
} from "@/app/[locale]/admin/orders/actions";
import { cn } from "@/lib/utils";

export function ToggleMealAllowanceButton({
  assignmentId,
  globalEnabled,
  addMealAllowance,
  excludeMealAllowance,
}: {
  assignmentId: string;
  globalEnabled: boolean;
  addMealAllowance?: boolean;
  excludeMealAllowance?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  const isMealIncluded = globalEnabled ? !excludeMealAllowance : addMealAllowance;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("gap-1.5 px-2", isMealIncluded && "text-primary bg-primary/10")}
      disabled={isPending}
      onClick={(e) => {
        e.preventDefault();
        startTransition(() => {
          if (globalEnabled) {
            toggleExcludeMealAllowance(assignmentId, !excludeMealAllowance);
          } else {
            toggleAssignmentMealAllowance(assignmentId, !addMealAllowance);
          }
        });
      }}
      title="Verpflegungsmehraufwand umschalten"
    >
      <Utensils className="size-4" />
    </Button>
  );
}

export function ToggleTravelAllowanceButton({
  assignmentId,
  excludeTravelAllowance,
}: {
  assignmentId: string;
  excludeTravelAllowance?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  const isTravelIncluded = !excludeTravelAllowance;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("gap-1.5 px-2", isTravelIncluded && "text-primary bg-primary/10")}
      disabled={isPending}
      onClick={(e) => {
        e.preventDefault();
        startTransition(() => {
          toggleExcludeTravelAllowance(assignmentId, !excludeTravelAllowance);
        });
      }}
      title="Fahrtkosten umschalten"
    >
      <Car className="size-4" />
    </Button>
  );
}
