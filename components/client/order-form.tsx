"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { qualifications } from "@/lib/validations";
import { createOrder } from "@/app/[locale]/client/orders/actions";

export function OrderForm() {
  const t = useTranslations("orders");
  const c = useTranslations("common");
  const eq = useTranslations("enums.qualification");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createOrder(formData);
      if (res.ok) {
        toast.success(t("created"));
        router.push("/client/orders");
        router.refresh();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-5">
      <div className="space-y-2">
        <Label>{t("qualification")}</Label>
        <Select name="requiredQualification" defaultValue={qualifications[0]}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {qualifications.map((q) => (
              <SelectItem key={q} value={q}>
                {eq(q)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="shiftDate">{t("shiftDate")}</Label>
          <Input id="shiftDate" name="shiftDate" type="date" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="startTime">{t("startTime")}</Label>
          <Input id="startTime" name="startTime" type="time" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endTime">{t("endTime")}</Label>
          <Input id="endTime" name="endTime" type="time" required />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="quantity">{t("quantity")}</Label>
        <Input
          id="quantity"
          name="quantity"
          type="number"
          min={1}
          max={50}
          defaultValue={1}
          required
          className="max-w-32"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">{t("notes")}</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={1000}
          className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? c("loading") : c("create")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/client/orders")}
        >
          {c("cancel")}
        </Button>
      </div>
    </form>
  );
}
