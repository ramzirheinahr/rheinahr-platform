import { getTranslations } from "next-intl/server";
import { fetchClientContracts } from "./actions";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContractSignDialog } from "./contract-sign-dialog";
import { FileSignature, Download } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ClientContractsPage() {
  const t = await getTranslations("contracts");
  
  let contracts: any[] = [];
  try {
    contracts = await fetchClientContracts();
  } catch (e) {
    //
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
      </div>

      <div className="rounded-md border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="p-3 font-medium">{t("period")}</th>
              <th className="p-3 font-medium">Shifts</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Date</th>
              <th className="p-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  No contracts found.
                </td>
              </tr>
            ) : (
              contracts.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3 font-medium">{c.period || "-"}</td>
                  <td className="p-3">{c.assignments?.length || 0}</td>
                  <td className="p-3">
                    <Badge variant={c.status === "signed" ? "default" : "secondary"}>
                      {c.status === "signed" ? t("signed") : t("pending")}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {format(new Date(c.createdAt), "dd.MM.yyyy")}
                  </td>
                  <td className="p-3 text-right">
                    {c.status === "pending" ? (
                      <ContractSignDialog contract={c} />
                    ) : (
                      <Button variant="outline" size="sm" className="gap-2" render={<a href={`/api/contracts/${c.id}/pdf`} target="_blank" rel="noreferrer" />}>
                        <Download className="size-4" />
                        Download PDF
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
