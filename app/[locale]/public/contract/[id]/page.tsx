import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ShieldCheck, CheckCircle2, FileText } from "lucide-react";
import { PublicContractDialog } from "@/components/public/public-contract-dialog";

export default async function PublicContractPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const contractId = typeof searchParams.contractId === "string" ? searchParams.contractId : undefined;
  
  // Find all pending contracts associated with this requestGroupId
  // A contract is associated with a requestGroupId if any of its assignments belong to an order with that requestGroupId
  const contracts = await prisma.clientContract.findMany({
    where: {
      ...(contractId ? { id: contractId } : {}),
      assignments: {
        some: { order: { requestGroupId: id } }
      }
    },
    include: {
      client: true,
      assignments: {
        include: { worker: true, order: true }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  if (contracts.length === 0) notFound();

  const clientName = contracts[0].client.facilityName;
  const pendingContracts = contracts.filter(c => c.status === "pending");

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">AÜV Vertrag unterzeichnen</h1>
            <p className="text-sm text-slate-500">RheinAhr Dienstleistungen GmbH</p>
          </div>
          <ShieldCheck className="size-8 text-blue-600 opacity-20" />
        </div>
      </div>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-8">
          <h2 className="text-xl font-semibold mb-2">{clientName}</h2>
          <p className="text-slate-600 leading-relaxed">
            Hier finden Sie die Arbeitnehmerüberlassungsverträge (AÜV) für Ihre aktuellen Anfragen. 
            Bitte prüfen Sie die Konditionen und unterzeichnen Sie den Vertrag elektronisch im Rahmen unserer bestehenden Hauptvereinbarung.
          </p>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
            Zu unterzeichnende Verträge ({pendingContracts.length})
          </h3>

          {pendingContracts.length === 0 ? (
            <div className="bg-white border rounded-xl p-12 text-center flex flex-col items-center justify-center">
              <div className="size-16 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mb-4">
                <CheckCircle2 className="size-8" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800">Alles erledigt!</h3>
              <p className="text-slate-500 mt-2">
                Aktuell liegen für diese Anfrage keine Verträge zur Unterschrift vor, oder sie wurden bereits signiert.
              </p>
            </div>
          ) : (
            pendingContracts.map(contract => (
              <div key={contract.id} className="bg-white rounded-xl shadow-sm border p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <FileText className="size-5 text-slate-400" />
                    <span className="font-semibold text-slate-800">Vertrag ({contract.period || "Zusammenfassung"})</span>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                    <div className="text-slate-500">
                      Umfasst {contract.assignments.length} Schicht(en)
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-4 shrink-0">
                  <PublicContractDialog 
                    requestGroupId={id}
                    contractId={contract.id}
                  />
                </div>
              </div>
            ))
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
