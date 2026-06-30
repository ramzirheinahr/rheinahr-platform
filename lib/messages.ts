import { prisma } from "@/lib/prisma";
import type { ThreadMessage } from "@/components/messages/message-thread";

// Loads a per-assignment message thread, ordered oldest→newest, with each
// message flagged as the current user's own (for bubble alignment).
export async function loadThreadMessages(
  assignmentId: string,
  currentUserId: string,
): Promise<ThreadMessage[]> {
  const rows = await prisma.message.findMany({
    where: { assignmentId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      senderId: true,
      createdAt: true,
      sender: { select: { fullName: true, email: true } },
    },
  });
  return rows.map((m) => ({
    id: m.id,
    body: m.body,
    mine: m.senderId === currentUserId,
    senderName: m.sender.fullName ?? m.sender.email,
    createdAt: m.createdAt.toISOString(),
  }));
}
