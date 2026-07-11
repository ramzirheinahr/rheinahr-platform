"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Utensils } from "lucide-react";
import { toggleAssignmentMealAllowance } from "@/app/[locale]/admin/orders/actions";
import { cn } from "@/lib/utils";

export function ToggleMealAllowanceButton({
  assignmentId,
  addMealAllowance,
}: {
  assignmentId: string;
  addMealAllowance?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("gap-1.5 px-2", addMealAllowance && "text-primary bg-primary/10")}
      disabled={isPending}
      onClick={(e) => {
        e.preventDefault();
        startTransition(() => {
          toggleAssignmentMealAllowance(assignmentId, !addMealAllowance);
        });
      }}
      title="Verpflegungsmehraufwand umschalten"
    >
      <Utensils className="size-4" />
    </Button>
  );
}
