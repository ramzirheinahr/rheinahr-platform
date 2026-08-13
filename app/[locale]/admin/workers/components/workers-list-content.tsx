import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import type { Qualification } from "@/lib/validations";
import { prisma } from "@/lib/prisma";
import { WorkersTable, type WorkerTableRow } from "@/components/admin/workers-table";
import { getMultipleWorkersHoursAccount } from "@/lib/hours-account";

async function getWorkers(qualification?: Qualification) {
  try {
    const where: Prisma.WorkerWhereInput = qualification ? { qualification } : {};
    return await prisma.worker.findMany({
      where,
      orderBy: { internalNumber: "asc" },
      include: { user: { select: { id: true, email: true, active: true, receiveEmails: true, _count: { select: { sessions: true } } } } },
    });
  } catch {
    return [];
  }
}

export async function WorkersListContent({ 
  qualification, 
  currentMonthStr 
}: { 
  qualification?: Qualification; 
  currentMonthStr: string 
}) {
  const c = await getTranslations("common");
  const eq = await getTranslations("enums.qualification");
  const ec = await getTranslations("enums.contractType");
  const ee = await getTranslations("enums.employmentType");
  
  const workers = await getWorkers(qualification);

  const rows: WorkerTableRow[] = [];
  
  const allHoursAccounts = await getMultipleWorkersHoursAccount(
    workers.map((w) => w.id),
    currentMonthStr,
    currentMonthStr
  );

  for (const w of workers) {
    let standAlt = 0;
    let zuAbgang = 0;
    let standNeu = 0;
    
    try {
      const hoursAcc = allHoursAccounts[w.id];
      if (hoursAcc) {
        standAlt = hoursAcc.initialCarryover;
        if (hoursAcc.months.length > 0) {
          const m = hoursAcc.months[hoursAcc.months.length - 1];
          zuAbgang = m.monthBalance;
          standNeu = m.cumulativeBalance;
        } else {
          standNeu = standAlt;
        }
      }
    } catch (err) {
      console.error(`Error calculating hours for worker ${w.id}:`, err);
    }

    rows.push({
      id: w.id,
      fullName: w.fullName,
      internalNumber: w.internalNumber ?? "",
      email: w.user.email,
      userId: w.user.id,
      receiveEmails: w.user.receiveEmails,
      active: w.user.active,
      qualification: w.qualification,
      qualificationLabel: eq(w.qualification),
      contractLabel: ec(w.contractType),
      employmentLabel: ee(w.employmentType),
      phone: w.phone || c("none"),
      activeSessionsCount: w.user._count.sessions,
      standAlt,
      zuAbgang,
      standNeu,
    });
  }

  return <WorkersTable rows={rows} showQualColumn={!qualification} />;
}
