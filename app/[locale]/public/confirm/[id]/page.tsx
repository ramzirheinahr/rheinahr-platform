import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatDateDE } from "@/lib/utils";
import { PublicConfirmDialog } from "@/components/public/public-confirm-dialog";
import { ShieldCheck, Calendar, Clock, MapPin, CheckCircle2 } from "lucide-react";
import { qualLabel } from "@/lib/invoicing";

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export default async function PublicConfirmPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const fromStr = typeof searchParams.from === "string" ? searchParams.from : undefined;
  const toStr = typeof searchParams.to === "string" ? searchParams.to : undefined;
  
  const dateFilter: any = {};
  if (fromStr) {
    dateFilter.gte = new Date(`${fromStr}T00:00:00.000Z`);
  }
  if (toStr) {
    dateFilter.lte = new Date(`${toStr}T23:59:59.999Z`);
  }
  
  // Find all assignments for this requestGroupId that are confirmed and need service confirmation
  const orders = await prisma.order.findMany({
    where: { 
      requestGroupId: id,
      ...(Object.keys(dateFilter).length > 0 ? { shiftDate: dateFilter } : {})
    },
    include: {
      client: true,
      assignments: {
        include: { worker: true, serviceConfirmation: true }
      }
    },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }]
  });

  if (orders.length === 0) notFound();

  const clientName = orders[0].client.facilityName;
  const address = orders[0].client.address;

  // We only care about completed/confirmed shifts that haven't been service-confirmed yet
  const unconfirmedShifts = orders.flatMap(o => 
    o.assignments
      .filter(a => a.status === "confirmed" && !a.serviceConfirmation)
      .map(a => ({
        assignmentId: a.id,
        workerName: a.worker.fullName,
        qualification: a.worker.qualification,
        shiftDate: o.shiftDate,
        startTime: o.startTime,
        endTime: o.endTime,
        breakMinutes: o.breakMinutes ?? 30,
        notes: o.notes
      }))
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Leistungsnachweise bestätigen</h1>
            <p className="text-sm text-slate-500">RheinAhr Dienstleistungen GmbH</p>
          </div>
          <ShieldCheck className="size-8 text-blue-600 opacity-20" />
        </div>
      </div>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-8">
          <h2 className="text-xl font-semibold mb-2">{clientName}</h2>
          {address && (
            <div className="flex items-center text-slate-600 text-sm mb-4">
              <MapPin className="size-4 mr-1.5 shrink-0" />
              <span className="whitespace-pre-line">{address}</span>
            </div>
          )}
          <p className="text-slate-600 leading-relaxed">
            Hier finden Sie die Liste der abgeschlossenen Schichten, die noch auf Ihre Bestätigung warten. 
            Bitte prüfen Sie die Zeiten und bestätigen Sie die Leistung elektronisch.
          </p>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            Zu bestätigende Schichten ({unconfirmedShifts.length})
          </h3>

          {unconfirmedShifts.length === 0 ? (
            <div className="bg-white border rounded-xl p-12 text-center flex flex-col items-center justify-center">
              <div className="size-16 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mb-4">
                <CheckCircle2 className="size-8" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800">Alles erledigt!</h3>
              <p className="text-slate-500 mt-2">
                Für diese Anfrage gibt es aktuell keine offenen Leistungsnachweise, die von Ihnen bestätigt werden müssen.
              </p>
            </div>
          ) : (
            unconfirmedShifts.map(shift => {
              const startMin = timeToMinutes(shift.startTime);
              const endMin = timeToMinutes(shift.endTime);
              const grossMin = endMin < startMin ? (endMin + 24 * 60) - startMin : endMin - startMin;
              const netMin = Math.max(0, grossMin - shift.breakMinutes);
              const hours = netMin / 60;

              return (
                <div key={shift.assignmentId} className="bg-white rounded-xl shadow-sm border p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800">{shift.workerName}</span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">
                        {qualLabel[shift.qualification as keyof typeof qualLabel] || shift.qualification}
                      </span>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="size-4 text-slate-400" />
                        {formatDateDE(shift.shiftDate)}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="size-4 text-slate-400" />
                        {shift.startTime} - {shift.endTime} Uhr
                      </div>
                      <div className="text-slate-500">
                        (Pause: {shift.breakMinutes} Min)
                      </div>
                    </div>
                    
                    {shift.notes && (
                      <div className="text-sm text-slate-500 pt-1">
                        <span className="font-medium text-slate-700">Bereich/Notiz:</span> {shift.notes}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right hidden sm:block">
                      <div className="text-sm text-slate-500">Nettozeit</div>
                      <div className="font-semibold text-slate-800">{hours.toFixed(2)} Std.</div>
                    </div>
                    
                    <PublicConfirmDialog 
                      requestGroupId={id}
                      assignmentId={shift.assignmentId}
                      scheduledHours={hours}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      <footer className="bg-slate-800 text-slate-300 py-6 text-center text-sm mt-auto">
        <p>&copy; {new Date().getFullYear()} RheinAhr Dienstleistungen GmbH</p>
        <p className="mt-1 text-slate-400">Integrität · Würde · Kompetenz · Vertrauen</p>
      </footer>
    </div>
  );
}
