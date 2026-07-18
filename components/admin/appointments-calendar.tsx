"use client";

import { useState } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from "date-fns";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { AppointmentDialog } from "./appointment-dialog";
import { deleteAppointment } from "@/app/[locale]/admin/appointments/actions";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AppointmentsCalendar({ appointments }: { appointments: any[] }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  
  const t = useTranslations("appointments");
  const tc = useTranslations("common");

  const firstDay = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
  const lastDay = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: firstDay, end: lastDay });

  function handleDayClick(day: Date) {
    setSelectedDate(day);
    setSelectedAppointment(null);
    setDialogOpen(true);
  }

  function handleAppointmentClick(e: React.MouseEvent, appt: any) {
    e.stopPropagation();
    setSelectedAppointment(appt);
    setSelectedDate(new Date(appt.date));
    setDialogOpen(true);
  }

  function handleAdd() {
    setSelectedDate(new Date());
    setSelectedAppointment(null);
    setDialogOpen(true);
  }

  function handleDeleteRequest() {
    setDeleteConfirmOpen(true);
  }

  async function confirmDelete() {
    if (!selectedAppointment) return;
    setDeleting(true);
    const res = await deleteAppointment(selectedAppointment.id);
    setDeleting(false);
    if (res.ok) {
      toast.success(t("deleted"));
      setDeleteConfirmOpen(false);
      setDialogOpen(false);
    } else {
      toast.error(res.error || tc("error"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
            <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
          </Button>
          <h2 className="text-xl font-bold">{format(currentMonth, "MMMM yyyy")}</h2>
          <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
            <ChevronRight className="w-4 h-4 rtl:rotate-180" />
          </Button>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="w-4 h-4 ltr:mr-2 rtl:ml-2" />
          {t("new")}
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden bg-white dark:bg-neutral-950">
        <div className="grid grid-cols-7 border-b bg-neutral-50 dark:bg-neutral-900">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="p-2 text-center text-sm font-medium text-neutral-500">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 auto-rows-[120px]">
          {days.map((day, i) => {
            const dayAppts = appointments.filter((a) => isSameDay(new Date(a.date), day));
            const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
            return (
              <div
                key={i}
                onClick={() => handleDayClick(day)}
                className={`p-1 border-b border-r rtl:border-r-0 rtl:border-l last:border-r-0 rtl:last:border-l-0 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors flex flex-col gap-1 overflow-hidden ${
                  !isCurrentMonth ? "opacity-50 bg-neutral-50 dark:bg-neutral-900" : ""
                }`}
              >
                <div className="text-sm font-medium p-1">{format(day, "d")}</div>
                <div className="flex-1 overflow-y-auto space-y-1 px-1">
                  {dayAppts.map((appt) => (
                    <div
                      key={appt.id}
                      onClick={(e) => handleAppointmentClick(e, appt)}
                      className="bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 text-xs rounded p-1 truncate"
                      title={appt.title}
                    >
                      {appt.startTime} {appt.title}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <AppointmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        appointment={selectedAppointment}
        selectedDate={selectedDate}
        onDeleteRequest={handleDeleteRequest}
      />

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("deleteConfirmDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
