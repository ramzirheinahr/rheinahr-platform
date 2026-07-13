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
  quantity?: number;
  facilityName?: string;
  workerName?: string;
}[]) {
  const showWorker = shifts.some((s) => s.workerName);
  const showFacility = shifts.some((s) => s.facilityName);
  const showQuantity = shifts.some((s) => s.quantity !== undefined);

  return `
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px; font-family: sans-serif; font-size: 14px;">
      <thead>
        <tr style="background-color: #f3f4f6; text-align: left;">
          ${showWorker ? \`<th style="padding: 10px; border: 1px solid #e5e7eb;">Mitarbeiter</th>\` : ""}
          ${showFacility ? \`<th style="padding: 10px; border: 1px solid #e5e7eb;">Einrichtung</th>\` : ""}
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Datum</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Zeit</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Qualifikation</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Bereich/Notizen</th>
          ${showQuantity ? \`<th style="padding: 10px; border: 1px solid #e5e7eb;">Anzahl</th>\` : ""}
        </tr>
      </thead>
      <tbody>
        ${shifts
          .map(
            (s) => \`
          <tr>
            \${showWorker ? \`<td style="padding: 10px; border: 1px solid #e5e7eb;">\${s.workerName}</td>\` : ""}
            \${showFacility ? \`<td style="padding: 10px; border: 1px solid #e5e7eb;">\${s.facilityName}</td>\` : ""}
            <td style="padding: 10px; border: 1px solid #e5e7eb;">\${formatDateDE(s.date)}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">\${s.startTime} - \${s.endTime}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">\${s.qualification}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">\${s.notes || "-"}</td>
            \${showQuantity ? \`<td style="padding: 10px; border: 1px solid #e5e7eb;">\${s.quantity}</td>\` : ""}
          </tr>
        \`
          )
          .join("")}
      </tbody>
    </table>
  `;
}
