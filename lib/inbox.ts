import { prisma } from "@/lib/prisma";
import { formatDateDE } from "@/lib/utils";
import type { Role } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Inbox domain rules
//
// A conversation is always between the agency (all admin/super_admin staff act
// as one team) and exactly one client or worker user. Agency staff therefore
// see every conversation; clients/workers only see threads they participate
// in. Client ↔ worker direct messaging deliberately does not exist
// (data minimization — coordination always runs through the agency).
// ─────────────────────────────────────────────────────────────────────────────

export function isAgencyRole(role: Role): boolean {
  return role === "admin" || role === "super_admin";
}

export type InboxViewer = { id: string; role: Role };

export type ConversationContext = "assignment" | "orderRequest" | "leaveRequest" | null;

export type ConversationListItem = {
  id: string;
  subject: string | null;
  context: ConversationContext;
  counterpartName: string;
  counterpartRole: Role | null; // null = counterpart is the agency team
  lastBody: string;
  lastAt: string; // ISO
  lastMine: boolean;
  unread: boolean;
};

export type ConversationMessage = {
  id: string;
  body: string;
  mine: boolean;
  fromAgency: boolean;
  senderName: string;
  createdAt: string; // ISO
};

export type ConversationDetail = {
  id: string;
  subject: string | null;
  context: ConversationContext;
  counterpartName: string;
  counterpartRole: Role | null;
  // Context deep-link targets (rendered role-appropriately by the pages).
  assignmentId: string | null;
  orderRef: string | null; // requestGroupId (or order id) for order detail pages
  leaveRequestId: string | null;
  messages: ConversationMessage[];
};

type ParticipantWithUser = {
  userId: string;
  lastReadAt: Date | null;
  user: {
    id: string;
    role: Role;
    fullName: string | null;
    email: string;
    worker: { fullName: string } | null;
    client: { facilityName: string } | null;
  };
};

const participantInclude = {
  select: {
    userId: true,
    lastReadAt: true,
    user: {
      select: {
        id: true,
        role: true,
        fullName: true,
        email: true,
        worker: { select: { fullName: true } },
        client: { select: { facilityName: true } },
      },
    },
  },
} as const;

function displayName(u: ParticipantWithUser["user"]): string {
  return u.client?.facilityName ?? u.worker?.fullName ?? u.fullName ?? u.email;
}

// The "other side" of a thread from the viewer's perspective. For agency
// staff that's the (single) non-agency participant; for clients/workers the
// counterpart is always the agency team (name is resolved via i18n in the UI
// when this returns null).
function counterpartOf(
  participants: ParticipantWithUser[],
  viewer: InboxViewer,
): { name: string | null; role: Role | null } {
  if (isAgencyRole(viewer.role)) {
    const other = participants.find((p) => !isAgencyRole(p.user.role));
    if (other) return { name: displayName(other.user), role: other.user.role };
    return { name: null, role: null };
  }
  return { name: null, role: null }; // agency team
}

function conversationContext(c: {
  assignmentId: string | null;
  requestGroupId: string | null;
  leaveRequestId: string | null;
}): ConversationContext {
  if (c.assignmentId) return "assignment";
  if (c.requestGroupId) return "orderRequest";
  if (c.leaveRequestId) return "leaveRequest";
  return null;
}

function visibleWhere(viewer: InboxViewer) {
  return isAgencyRole(viewer.role)
    ? {}
    : { participants: { some: { userId: viewer.id } } };
}

// ── Lazy migration of the legacy per-assignment chat ─────────────────────────
// Older Message rows carry only `assignmentId`. On first access the thread is
// wrapped in a Conversation, orphan messages are attached, and read cursors
// are seeded to "now" for everyone (those messages were readable in the old
// UI — don't flood badges retroactively).
export async function getOrCreateAssignmentConversation(assignmentId: string) {
  const existing = await prisma.conversation.findUnique({
    where: { assignmentId },
    select: { id: true },
  });
  if (existing) return existing;

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      worker: { select: { userId: true } },
      order: {
        select: { shiftDate: true, client: { select: { facilityName: true } } },
      },
    },
  });
  if (!assignment) return null;

  const admins = await prisma.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, active: true },
    select: { id: true },
  });

  const now = new Date();
  const conversation = await prisma.conversation.create({
    data: {
      assignmentId,
      subject: `${formatDateDE(assignment.order.shiftDate)} · ${assignment.order.client.facilityName}`,
      participants: {
        create: [
          { userId: assignment.worker.userId, lastReadAt: now },
          ...admins
            .filter((a) => a.id !== assignment.worker.userId)
            .map((a) => ({ userId: a.id, lastReadAt: now })),
        ],
      },
    },
    select: { id: true },
  });

  // Attach legacy messages and keep the thread's sort position truthful.
  await prisma.message.updateMany({
    where: { assignmentId, conversationId: null },
    data: { conversationId: conversation.id },
  });
  const latest = await prisma.message.findFirst({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (latest) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: latest.createdAt },
    });
  }
  return conversation;
}

// Find (or start) the change-request thread a client keeps per order request.
export async function getOrCreateRequestConversation(
  requestGroupId: string,
  clientUserId: string,
  subject: string,
) {
  const existing = await prisma.conversation.findFirst({
    where: { requestGroupId, participants: { some: { userId: clientUserId } } },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      requestGroupId,
      subject,
      createdById: clientUserId,
      participants: { create: [{ userId: clientUserId, lastReadAt: new Date() }] },
    },
    select: { id: true },
  });
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function listConversations(
  viewer: InboxViewer,
): Promise<ConversationListItem[]> {
  const rows = await prisma.conversation.findMany({
    where: visibleWhere(viewer),
    orderBy: { lastMessageAt: "desc" },
    take: 200,
    select: {
      id: true,
      subject: true,
      assignmentId: true,
      requestGroupId: true,
      leaveRequestId: true,
      lastMessageAt: true,
      participants: participantInclude,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, senderId: true, createdAt: true },
      },
    },
  });

  return rows
    .filter((c) => c.messages.length > 0)
    .map((c) => {
      const last = c.messages[0];
      const my = c.participants.find((p) => p.userId === viewer.id);
      const counterpart = counterpartOf(c.participants, viewer);
      return {
        id: c.id,
        subject: c.subject,
        context: conversationContext(c),
        counterpartName: counterpart.name ?? "",
        counterpartRole: counterpart.role,
        lastBody: last.body,
        lastAt: last.createdAt.toISOString(),
        lastMine: last.senderId === viewer.id,
        unread:
          last.senderId !== viewer.id &&
          (!my?.lastReadAt || my.lastReadAt < last.createdAt),
      };
    });
}

// Unread-conversation count for the nav badge. Counts threads whose latest
// message is from someone else and newer than the viewer's read cursor.
export async function countUnreadConversations(
  viewer: InboxViewer,
): Promise<number> {
  const rows = await prisma.conversation.findMany({
    where: visibleWhere(viewer),
    select: {
      participants: {
        where: { userId: viewer.id },
        select: { lastReadAt: true },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { senderId: true, createdAt: true },
      },
    },
  });
  return rows.filter((c) => {
    const last = c.messages[0];
    if (!last || last.senderId === viewer.id) return false;
    const readAt = c.participants[0]?.lastReadAt;
    return !readAt || readAt < last.createdAt;
  }).length;
}

// Loads one thread if (and only if) the viewer may see it.
export async function loadConversation(
  conversationId: string,
  viewer: InboxViewer,
): Promise<ConversationDetail | null> {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      subject: true,
      assignmentId: true,
      requestGroupId: true,
      leaveRequestId: true,
      assignment: {
        select: { order: { select: { id: true, requestGroupId: true } } },
      },
      participants: participantInclude,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          senderId: true,
          createdAt: true,
          sender: {
            select: { fullName: true, email: true, role: true, worker: { select: { fullName: true } }, client: { select: { facilityName: true } } },
          },
        },
      },
    },
  });
  if (!c) return null;

  const isParticipant = c.participants.some((p) => p.userId === viewer.id);
  if (!isAgencyRole(viewer.role) && !isParticipant) return null;

  const counterpart = counterpartOf(c.participants, viewer);
  return {
    id: c.id,
    subject: c.subject,
    context: conversationContext(c),
    counterpartName: counterpart.name ?? "",
    counterpartRole: counterpart.role,
    assignmentId: c.assignmentId,
    leaveRequestId: c.leaveRequestId,
    orderRef:
      c.requestGroupId ??
      c.assignment?.order.requestGroupId ??
      c.assignment?.order.id ??
      null,
    messages: c.messages.map((m) => ({
      id: m.id,
      body: m.body,
      mine: m.senderId === viewer.id,
      fromAgency: isAgencyRole(m.sender.role),
      senderName:
        m.sender.client?.facilityName ??
        m.sender.worker?.fullName ??
        m.sender.fullName ??
        m.sender.email,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

// Users an agency member can start a thread with (active clients + workers).
export type InboxRecipient = { id: string; name: string; role: Role };

export async function listRecipients(): Promise<InboxRecipient[]> {
  const users = await prisma.user.findMany({
    where: { active: true, role: { in: ["client", "worker"] } },
    select: {
      id: true,
      role: true,
      fullName: true,
      email: true,
      worker: { select: { fullName: true } },
      client: { select: { facilityName: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return users
    .map((u) => ({ id: u.id, role: u.role, name: displayName(u) }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}
