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
