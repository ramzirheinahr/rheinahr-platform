import type { Role } from "@prisma/client";

// Portal-relative deep links for notifications. Stored locale-agnostic on the
// Notification row; the i18n <Link> prefixes the active locale when rendered.
// admin + super_admin share the /admin portal.
export function portalPrefix(role: Role): "/admin" | "/client" | "/worker" {
  if (role === "worker") return "/worker";
  if (role === "client") return "/client";
  return "/admin";
}

// Deep link to an order request (grouped shifts). Admins open the request
// detail, clients open their own request view.
export function orderLink(role: Role, requestGroupId: string): string {
  return `${portalPrefix(role)}/orders/${requestGroupId}`;
}

// Deep link to an inbox conversation thread.
export function inboxLink(role: Role, conversationId: string): string {
  return `${portalPrefix(role)}/inbox/${conversationId}`;
}

// Worker portal landing (monthly shift sheet) — where an assigned/confirmed
// shift is opened.
export function workerShiftLink(): string {
  return "/worker";
}

import { formatDateDE } from "@/lib/utils";

export function buildShiftHtmlTable(shifts: {
  date: Date;
  startTime: string;
  endTime: string;
  qualification: string;
  notes?: string;
  workerName?: string;
  workerSalutation?: string | null;
  workerBirthDate?: Date | string | null;
  facilityName?: string;
  quantity?: number;
}[]) {
  const showWorker = shifts.some((s) => s.workerName);
  const showFacility = shifts.some((s) => s.facilityName);
  const showQuantity = shifts.some((s) => s.quantity !== undefined);

  return `
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px; font-family: sans-serif; font-size: 14px;">
      <thead>
        <tr style="background-color: #f3f4f6; text-align: left;">
          ${showWorker ? `<th style="padding: 10px; border: 1px solid #e5e7eb;">Mitarbeiter</th>` : ""}
          ${showFacility ? `<th style="padding: 10px; border: 1px solid #e5e7eb;">Einrichtung</th>` : ""}
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Datum</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Zeit</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Qualifikation</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Bereich/Notizen</th>
          ${showQuantity ? `<th style="padding: 10px; border: 1px solid #e5e7eb;">Anzahl</th>` : ""}
        </tr>
      </thead>
      <tbody>
        ${shifts
          .map((s) => {
            let workerCell = s.workerName || "";
            if (s.workerSalutation) {
              const sal = s.workerSalutation.toLowerCase() === "frau" ? "Frau" : s.workerSalutation.toLowerCase() === "herr" ? "Herr" : s.workerSalutation;
              if (!workerCell.startsWith(sal)) {
                workerCell = `${sal} ${workerCell}`;
              }
            }
            let birthDateText = "";
            if (s.workerBirthDate) {
              const bDate = typeof s.workerBirthDate === "string" ? new Date(s.workerBirthDate) : s.workerBirthDate;
              if (!isNaN(bDate.getTime())) {
                birthDateText = `<div style="font-size: 12px; color: #64748b; margin-top: 2px;">Geb.: ${formatDateDE(bDate)}</div>`;
              }
            }

            return `
          <tr>
            ${showWorker ? `<td style="padding: 10px; border: 1px solid #e5e7eb;"><div style="font-weight: 500;">${workerCell}</div>${birthDateText}</td>` : ""}
            ${showFacility ? `<td style="padding: 10px; border: 1px solid #e5e7eb;">${s.facilityName}</td>` : ""}
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${formatDateDE(s.date)}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${s.startTime} - ${s.endTime}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${s.qualification}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${s.notes || "-"}</td>
            ${showQuantity ? `<td style="padding: 10px; border: 1px solid #e5e7eb;">${s.quantity}</td>` : ""}
          </tr>
        `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

import { prisma } from "@/lib/prisma";

export async function getFacilityClientUserIds(
  clientIdOrUserId: string,
  options?: { onlyWithEmailEnabled?: boolean }
): Promise<string[]> {
  if (!clientIdOrUserId) return [];
  const client = await prisma.client.findFirst({
    where: {
      OR: [
        { id: clientIdOrUserId },
        { userId: clientIdOrUserId },
      ],
    },
    select: {
      userId: true,
      user: {
        select: { id: true, active: true, receiveEmails: true },
      },
      subUsers: {
        where: { active: true },
        select: { id: true, active: true, receiveEmails: true },
      },
    },
  });

  if (!client) return [clientIdOrUserId];
  const ids: string[] = [];
  
  if (client.user) {
    if (client.user.active !== false) {
      if (!options?.onlyWithEmailEnabled || client.user.receiveEmails) {
        ids.push(client.userId);
      }
    }
  } else if (client.userId) {
    ids.push(client.userId);
  }

  for (const u of client.subUsers) {
    if (u.active !== false) {
      if (!options?.onlyWithEmailEnabled || u.receiveEmails) {
        ids.push(u.id);
      }
    }
  }

  return [...new Set(ids)];
}

