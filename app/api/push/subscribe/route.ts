import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(500), auth: z.string().max(500) }),
});

// Store a browser Web Push subscription for the signed-in user. Upsert by
// endpoint so re-subscribing the same device just refreshes its keys/owner.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const parsed = subscriptionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Bad Request", { status: 400 });
  const { endpoint, keys } = parsed.data;
  const userAgent = req.headers.get("user-agent")?.slice(0, 300) ?? null;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent },
  });

  return NextResponse.json({ ok: true });
}

// Remove a subscription (user turned notifications off / unsubscribed a device).
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const parsed = z
    .object({ endpoint: z.string().url().max(1000) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Bad Request", { status: 400 });

  // Scope the delete to this user so one account can't remove another's device.
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: parsed.data.endpoint, userId: user.id },
  });

  return NextResponse.json({ ok: true });
}
