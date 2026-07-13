import webpush from "web-push";
import { prisma } from "@/lib/prisma";

// Web Push sender. Configured from VAPID env vars; if they're missing (e.g.
// local dev without keys) it silently no-ops so notifications still work in-app.
const PUBLIC = process.env.VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:info@rheinahr-gmbh.de";

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!PUBLIC || !PRIVATE) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string; // deep link opened on click
  tag?: string; // coalesce repeats (e.g. one per conversation)
  htmlBody?: string;
  skipEmail?: boolean;
};

import { sendEmailToUsers } from "@/lib/email";

// Send a push and email to every device of the given users. Best-effort and non-blocking
// for the caller's happy path: failures are swallowed, and dead endpoints
// (404/410) are pruned so the table stays clean. Never throws.
export async function pushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<void> {
  // Fire and forget email notification
  if (!payload.skipEmail) {
    sendEmailToUsers(userIds, {
      subject: payload.title,
      body: payload.body,
      html: payload.htmlBody,
      url: payload.url,
    }).catch((err) => console.error("Failed to send email notification", err));
  }

  if (!ensureConfigured() || userIds.length === 0) return;

  const uniqueIds = [...new Set(userIds)];
  const subs = await prisma.pushSubscription
    .findMany({
      where: { userId: { in: uniqueIds } },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    })
    .catch(() => []);
  if (subs.length === 0) return;

  const data = JSON.stringify(payload);
  const dead: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
        );
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
      }
    }),
  );

  if (dead.length) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } }).catch(() => {});
  }
}
