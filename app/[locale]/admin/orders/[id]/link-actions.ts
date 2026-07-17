"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { sendEmailToUsers } from "@/lib/email";
import { buildShiftHtmlTable } from "@/lib/notify";
import { qualLabel } from "@/lib/invoicing";

export async function sendPublicLinkEmail({
  requestGroupId,
  type,
  contractId,
  startDate,
  endDate,
}: {
  requestGroupId: string;
  type: "contract" | "confirm";
  contractId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return { ok: false, error: "forbidden" };
  }

  let clientId: string | undefined;
  let clientName: string | undefined;
  let subject = "";
  let body = "";
  // Use NEXT_PUBLIC_APP_URL if available, fallback to production url
  let linkUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://platform.rheinahr-gmbh.de"}/de/public/${type}/${requestGroupId}`;
  
  const shiftsData: any[] = [];

  if (type === "contract") {
    if (!contractId) return { ok: false, error: "contractId missing" };
    
    const contract = await prisma.clientContract.findUnique({
      where: { id: contractId },
      include: {
        client: true,
        assignments: {
          include: { worker: true, order: true },
          orderBy: { order: { shiftDate: "asc" } }
        }
      }
    });

    if (!contract) return { ok: false, error: "not_found" };
    
    clientId = contract.client.userId;
    clientName = contract.client.facilityName;
    
    contract.assignments.forEach(a => {
      shiftsData.push({
        date: a.order.shiftDate,
        startTime: a.order.startTime,
        endTime: a.order.endTime,
        qualification: qualLabel[a.order.requiredQualification as keyof typeof qualLabel] || a.order.requiredQualification,
        workerName: a.worker.fullName,
      });
    });

    subject = `AÜV Vertrag zur Unterzeichnung - ${clientName}`;
    linkUrl += `?contractId=${contractId}`;
    
    body = `Sehr geehrte Damen und Herren,\n\nbitte prüfen Sie die Konditionen für die folgenden Schichten und unterzeichnen Sie den Vertrag elektronisch im Rahmen unserer bestehenden Hauptvereinbarung über den folgenden Link:\n\n${linkUrl}\n\nFolgende Schichten sind Bestandteil dieses Vertrags:`;

  } else {
    // confirm
    const dateFilter: any = {};
    const queryParams = new URLSearchParams();
    if (startDate) {
      dateFilter.gte = new Date(`${startDate}T00:00:00.000Z`);
      queryParams.set("from", startDate);
    }
    if (endDate) {
      dateFilter.lte = new Date(`${endDate}T23:59:59.999Z`);
      queryParams.set("to", endDate);
    }

    const qs = queryParams.toString();
    if (qs) linkUrl += `?${qs}`;

    const orders = await prisma.order.findMany({
      where: {
        requestGroupId,
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

    if (orders.length === 0) return { ok: false, error: "not_found" };

    clientId = orders[0].client.userId;
    clientName = orders[0].client.facilityName;

    orders.forEach(o => {
      o.assignments.forEach(a => {
        if (a.status === "confirmed" && !a.serviceConfirmation) {
          shiftsData.push({
            date: o.shiftDate,
            startTime: o.startTime,
            endTime: o.endTime,
            qualification: qualLabel[o.requiredQualification as keyof typeof qualLabel] || o.requiredQualification,
            workerName: a.worker.fullName,
            notes: o.notes
          });
        }
      });
    });

    subject = `Leistungsnachweise zur Bestätigung - ${clientName}`;
    body = `Sehr geehrte Damen und Herren,\n\nbitte prüfen Sie die Zeiten der folgenden abgeschlossenen Schichten und bestätigen Sie die Leistung elektronisch über den folgenden Link:\n\n${linkUrl}\n\nZu bestätigende Schichten:`;
  }

  if (!clientId) return { ok: false, error: "no_client" };
  if (shiftsData.length === 0) return { ok: false, error: "no_shifts" };

  const tableHtml = buildShiftHtmlTable(shiftsData);
  
  const html = `
    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
      <p>Sehr geehrte Damen und Herren,</p>
      
      <p>${type === "contract" ? 
        `bitte prüfen Sie die Konditionen für die folgenden Schichten und unterzeichnen Sie den zugehörigen Vertrag elektronisch im Rahmen unserer bestehenden Hauptvereinbarung.` : 
        `bitte prüfen Sie die Zeiten der folgenden abgeschlossenen Schichten und bestätigen Sie die Leistung elektronisch.`}</p>
      
      <p>
        <a href="${linkUrl}" style="display: inline-block; padding: 10px 20px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">
          ${type === "contract" ? "Vertrag unterzeichnen" : "Leistungsnachweise bestätigen"}
        </a>
      </p>
      <p>Oder nutzen Sie diesen Link: <a href="${linkUrl}">${linkUrl}</a></p>
      
      <h3 style="margin-top: 30px;">Zusammenfassung der Schichten:</h3>
      ${tableHtml}
    </div>
  `;

  await sendEmailToUsers([clientId], {
    subject,
    body,
    html
  });

  return { ok: true };
}
