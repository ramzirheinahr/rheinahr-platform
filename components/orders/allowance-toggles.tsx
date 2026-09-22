"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Utensils, Car } from "lucide-react";
import { 
  toggleAssignmentMealAllowance, 
  toggleExcludeTravelAllowance
} from "@/app/[locale]/admin/orders/actions";
import { cn } from "@/lib/utils";

export function ToggleMealAllowanceButton({
  assignmentId,
  active,
  globalEnabled,
  addMealAllowance,
  excludeMealAllowance,
}: {
  assignmentId: string;
  active?: boolean;
  globalEnabled?: boolean;
  addMealAllowance?: boolean;
  excludeMealAllowance?: boolean;
}) {
  const t = useTranslations("allowances");
  const [isPending, startTransition] = useTransition();

  const isMealIncluded = active !== undefined 
    ? active 
    : Boolean(addMealAllowance || (globalEnabled && !excludeMealAllowance));

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "h-7 w-7 p-0 transition-colors",
        isMealIncluded 
          ? "text-primary bg-primary/10 hover:bg-primary/20 hover:text-primary font-medium" 
          : "text-muted-foreground/60 hover:text-foreground hover:bg-muted"
      )}
      disabled={isPending}
      onClick={(e) => {
        e.preventDefault();
        startTransition(() => {
          toggleAssignmentMealAllowance(assignmentId, !isMealIncluded);
        });
      }}
      title={isMealIncluded ? t("removeMeal") : t("addMeal")}
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
  const t = useTranslations("allowances");
  const [isPending, startTransition] = useTransition();

  const isTravelIncluded = !excludeTravelAllowance;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "h-7 w-7 p-0 transition-colors",
        isTravelIncluded 
          ? "text-primary bg-primary/10 hover:bg-primary/20 hover:text-primary font-medium" 
          : "text-muted-foreground/60 hover:text-foreground hover:bg-muted"
      )}
      disabled={isPending}
      onClick={(e) => {
        e.preventDefault();
        startTransition(() => {
          toggleExcludeTravelAllowance(assignmentId, !excludeTravelAllowance);
        });
      }}
      title={isTravelIncluded ? t("removeTravel") : t("addTravel")}
    >
      <Car className="size-4" />
    </Button>
  );
}
