"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isAgencyRole } from "@/lib/inbox";

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

async function notifyNewMessage(userIds: string[], content: string) {
  if (userIds.length === 0) return;
  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: "new_message" as const,
      channel: "in_app" as const,
      content,
    })),
  });
}

// Starts one or more threads. Agency staff pick the recipients (one private
// thread per recipient — replies never leak to other recipients); clients and
// workers always write to the agency team.
export async function startConversation(input: {
  subject?: string;
  body: string;
  recipientIds?: string[];
}): Promise<InboxActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "forbidden" };

  const body = bodySchema.safeParse(input.body);
  const subject = subjectSchema.safeParse(input.subject ?? "");
  if (!body.success || !subject.success) return { ok: false, error: "invalid" };
  const subjectValue = subject.data || null;

  const now = new Date();

  if (isAgencyRole(user.role)) {
    const ids = z.array(z.string().uuid()).min(1).max(100).safeParse(input.recipientIds);
    if (!ids.success) return { ok: false, error: "invalid" };

    const recipients = await prisma.user.findMany({
      where: { id: { in: ids.data }, active: true, role: { in: ["client", "worker"] } },
      select: { id: true },
    });
    if (recipients.length === 0) return { ok: false, error: "invalid" };

    const created: string[] = [];
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
    }

    await notifyNewMessage(
      recipients.map((r) => r.id),
      preview(body.data),
    );
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

  await notifyNewMessage(await activeAdminIds(), preview(body.data));
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
  // client/worker → every active agency member.
  const recipientIds = isAgencyRole(user.role)
    ? conversation.participants
        .filter((p) => !isAgencyRole(p.user.role) && p.userId !== user.id)
        .map((p) => p.userId)
    : await activeAdminIds(user.id);
  await notifyNewMessage(recipientIds, preview(body.data));

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
