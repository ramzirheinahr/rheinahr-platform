import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { ContractGenerator } from "./contract-generator";

export const dynamic = "force-dynamic";

export default async function NewContractPage() {
  const t = await getTranslations("contracts");
  
  // Fetch clients to populate the dropdown
  const clients = await prisma.client.findMany({
    orderBy: { facilityName: "asc" },
    select: { id: true, facilityName: true }
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("generate")}</h1>
      <ContractGenerator clients={clients} />
    </div>
  );
}
