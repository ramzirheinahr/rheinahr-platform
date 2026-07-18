"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { createAppointment, updateAppointment } from "@/app/[locale]/admin/appointments/actions";
import { format } from "date-fns";

export function AppointmentDialog({
  open,
  onOpenChange,
  appointment,
  selectedDate,
  onDeleteRequest,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  appointment?: any;
  selectedDate?: Date;
  onDeleteRequest?: () => void;
}) {
  const t = useTranslations("appointments");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);

  async function action(formData: FormData) {
    setLoading(true);
    let res;
    if (appointment) {
      res = await updateAppointment(appointment.id, formData);
    } else {
      res = await createAppointment(formData);
    }
    setLoading(false);
    if (res.ok) {
      toast.success(appointment ? t("updated") : t("created"));
      onOpenChange(false);
    } else {
      toast.error(res.error || tc("error"));
    }
  }

  const defaultDate = appointment?.date
    ? format(new Date(appointment.date), "yyyy-MM-dd")
    : selectedDate
      ? format(selectedDate, "yyyy-MM-dd")
      : format(new Date(), "yyyy-MM-dd");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{appointment ? t("edit") : t("new")}</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <div className="space-y-1">
            <Label>{t("form.title")}</Label>
            <Input name="title" required defaultValue={appointment?.title} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1 col-span-1">
              <Label>{t("form.date")}</Label>
              <Input name="date" type="date" required defaultValue={defaultDate} />
            </div>
            <div className="space-y-1">
              <Label>{t("form.startTime")}</Label>
              <Input name="startTime" type="time" required defaultValue={appointment?.startTime} />
            </div>
            <div className="space-y-1">
              <Label>{t("form.endTime")}</Label>
              <Input name="endTime" type="time" required defaultValue={appointment?.endTime} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("form.location")}</Label>
            <Input name="location" defaultValue={appointment?.location} />
          </div>
          <div className="space-y-1">
            <Label>{t("form.description")}</Label>
            <Textarea name="description" defaultValue={appointment?.description} />
          </div>
          
          <div className="flex justify-between items-center pt-4">
            {appointment ? (
              <Button type="button" variant="destructive" onClick={onDeleteRequest}>
                {tc("delete")}
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={loading}>
                {tc("save")}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
