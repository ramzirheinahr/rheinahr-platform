import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { ContractsList } from "./contracts-list";

export const dynamic = "force-dynamic";

export default async function AdminContractsPage() {
  const t = await getTranslations("contracts");
  
  const contracts = await prisma.clientContract.findMany({
    include: {
      client: true,
      assignments: {
        include: {
          worker: true,
          order: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Vertragsmanagement</h1>
        <Button render={<Link href="/admin/contracts/new" />} className="gap-2 bg-slate-800 hover:bg-slate-700">
          <Plus className="size-4" />
          {t("generate")}
        </Button>
      </div>

      <ContractsList contracts={contracts} translations={{}} />
    </div>
  );
}
