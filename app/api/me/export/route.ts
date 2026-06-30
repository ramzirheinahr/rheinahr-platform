import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

// DSGVO Art. 20 — self-service export of the signed-in user's personal data
// as a JSON download. Returns only data relating to the requesting user.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      preferredLanguage: true,
      createdAt: true,
      worker: {
        include: {
          availability: true,
          assignments: {
            include: {
              order: { select: { shiftDate: true, startTime: true, endTime: true } },
              serviceConfirmation: true,
            },
          },
        },
      },
      client: {
        include: {
          orders: { include: { assignments: true } },
        },
      },
      notifications: true,
    },
  });

  await audit({
    userId: user.id,
    action: "data.export",
    entity: "User",
    entityId: user.id,
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    note: "Datenexport gemäß Art. 20 DSGVO — RheinAhr Dienstleistungen GmbH",
    data: account,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="meine-daten-${user.id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
