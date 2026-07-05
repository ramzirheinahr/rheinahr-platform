"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isAgencyRole } from "@/lib/inbox";
import { inboxLink } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";
import type { Role } from "@prisma/client";

export type InboxActionState = {
  ok: boolean;
  error?: "forbidden" | "invalid" | "saveError";
  // Set when exactly one thread was created — the UI navigates straight to it.
  conversationId?: string;
};

const bodySchema = z.string().trim().min(1).max(4000);
const subjectSchema = z.string().trim().max(140);

function preview(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

async function activeAdminIds(exclude?: string): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, active: true },
    select: { id: true },
  });
  return admins.map((a) => a.id).filter((id) => id !== exclude);
}

// Each recipient's notification deep-links to the thread in *their* portal.
async function notifyNewMessage(
  recipients: { userId: string; link: string }[],
  content: string,
) {
  if (recipients.length === 0) return;
  await prisma.notification.createMany({
    data: recipients.map((r) => ({
      userId: r.userId,
      type: "new_message" as const,
      channel: "in_app" as const,
      content,
      link: r.link,
    })),
  });
  // Mobile push per recipient (their own deep link). tag=inbox coalesces bursts.
  await Promise.all(
    recipients.map((r) =>
      pushToUsers([r.userId], { title: "Neue Nachricht", body: content, url: r.link, tag: "inbox" }),
    ),
  );
}

// Starts one or more threads. Agency staff pick the recipients (one private
// thread per recipient — replies never leak to other recipients); clients and
// workers always write to the agency team.
export async function startConversation(input: {
  subject?: string;
  body: string;
  recipientIds?: string[];
  broadcastTarget?: "all" | "workers" | "clients";
}): Promise<InboxActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "forbidden" };

  const body = bodySchema.safeParse(input.body);
  const subject = subjectSchema.safeParse(input.subject ?? "");
  if (!body.success || !subject.success) return { ok: false, error: "invalid" };
  const subjectValue = subject.data || null;

  const now = new Date();

  if (isAgencyRole(user.role)) {
    let recipients: { id: string; role: Role }[] = [];

    if (input.broadcastTarget) {
      const rolesToFetch =
        input.broadcastTarget === "all" ? ["client", "worker"] :
        input.broadcastTarget === "workers" ? ["worker"] : ["client"];

      recipients = await prisma.user.findMany({
        where: { active: true, role: { in: rolesToFetch as Role[] } },
        select: { id: true, role: true },
      });
    } else {
      const ids = z.array(z.string().uuid()).min(1).max(5000).safeParse(input.recipientIds);
      if (!ids.success) return { ok: false, error: "invalid" };

      recipients = await prisma.user.findMany({
        where: { id: { in: ids.data }, active: true, role: { in: ["client", "worker"] } },
        select: { id: true, role: true },
      });
    }

    if (recipients.length === 0) return { ok: false, error: "invalid" };

    const created: string[] = [];
    // Per-recipient thread → each notification deep-links to that recipient's
    // own conversation in their portal.
    const notifyList: { userId: string; link: string }[] = [];
    for (const recipient of recipients) {
      const conversation = await prisma.conversation.create({
        data: {
          subject: subjectValue,
          createdById: user.id,
          lastMessageAt: now,
          participants: {
            create: [
              { userId: recipient.id },
              { userId: user.id, lastReadAt: now },
            ],
          },
          messages: { create: { senderId: user.id, body: body.data } },
        },
        select: { id: true },
      });
      created.push(conversation.id);
      notifyList.push({
        userId: recipient.id,
        link: inboxLink(recipient.role, conversation.id),
      });
    }

    await notifyNewMessage(notifyList, preview(body.data));
    await audit({
      userId: user.id,
      action: "conversation.create",
      entity: "Conversation",
      entityId: created.join(","),
      metadata: { recipients: recipients.length },
    });
    return { ok: true, conversationId: created.length === 1 ? created[0] : undefined };
  }

  // Client / worker → the agency team.
  const conversation = await prisma.conversation.create({
    data: {
      subject: subjectValue,
      createdById: user.id,
      lastMessageAt: now,
      participants: { create: [{ userId: user.id, lastReadAt: now }] },
      messages: { create: { senderId: user.id, body: body.data } },
    },
    select: { id: true },
  });

  const adminLink = inboxLink("admin", conversation.id);
  await notifyNewMessage(
    (await activeAdminIds()).map((userId) => ({ userId, link: adminLink })),
    preview(body.data),
  );
  await audit({
    userId: user.id,
    action: "conversation.create",
    entity: "Conversation",
    entityId: conversation.id,
  });
  return { ok: true, conversationId: conversation.id };
}

// Replies inside an existing thread the sender may access.
export async function sendConversationMessage(
  conversationId: string,
  rawBody: string,
): Promise<InboxActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "forbidden" };

  const body = bodySchema.safeParse(rawBody);
  if (!body.success) return { ok: false, error: "invalid" };

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      participants: {
        select: { userId: true, user: { select: { role: true } } },
      },
    },
  });
  if (!conversation) return { ok: false, error: "saveError" };

  const isParticipant = conversation.participants.some((p) => p.userId === user.id);
  if (!isAgencyRole(user.role) && !isParticipant) {
    return { ok: false, error: "forbidden" };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.message.create({
      data: { conversationId, senderId: user.id, body: body.data },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now },
    }),
    prisma.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      create: { conversationId, userId: user.id, lastReadAt: now },
      update: { lastReadAt: now },
    }),
  ]);

  // Notify the other side: agency → the client/worker participants;
  // client/worker → every active agency member. Each deep-links to the thread
  // in the recipient's own portal.
  const recipients = isAgencyRole(user.role)
    ? conversation.participants
        .filter((p) => !isAgencyRole(p.user.role) && p.userId !== user.id)
        .map((p) => ({
          userId: p.userId,
          link: inboxLink(p.user.role, conversationId),
        }))
    : (await activeAdminIds(user.id)).map((userId) => ({
        userId,
        link: inboxLink("admin", conversationId),
      }));
  await notifyNewMessage(recipients, preview(body.data));

  await audit({
    userId: user.id,
    action: "message.send",
    entity: "Conversation",
    entityId: conversationId,
  });
  return { ok: true };
}

// Moves the viewer's read cursor to now (called when a thread is opened).
export async function markConversationRead(
  conversationId: string,
): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, participants: { select: { userId: true } } },
  });
  if (!conversation) return { ok: false };
  const isParticipant = conversation.participants.some((p) => p.userId === user.id);
  if (!isAgencyRole(user.role) && !isParticipant) return { ok: false };

  await prisma.conversationParticipant.upsert({
    where: { conversationId_userId: { conversationId, userId: user.id } },
    create: { conversationId, userId: user.id, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
  return { ok: true };
}
