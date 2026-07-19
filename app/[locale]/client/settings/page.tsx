import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { ClientProfileForm } from "./profile-form";
import { SubUsersSection, type SubUser } from "./sub-users-section";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ClientSettingsPage() {
  const actor = await getCurrentUser();
  if (!actor || actor.role !== "client") return notFound();
  
  const t = await getTranslations("clientUsers");

  const actorUser = await prisma.user.findUnique({
    where: { id: actor.id },
    include: {
      client: { select: { id: true } },
      clientFacility: { select: { id: true, userId: true } },
    },
  });

  if (!actorUser) return notFound();

  // Resolve the facility ID
  const facilityId = actorUser.client?.id || actorUser.clientFacility?.id;
  if (!facilityId) return notFound();

  // Is this actor the primary user for the facility?
  const isMainUser = !!actorUser.client;

  // Fetch all users for this facility
  const facility = await prisma.client.findUnique({
    where: { id: facilityId },
    include: {
      user: true, // Primary
      subUsers: true, // Sub users
    }
  });

  if (!facility) return notFound();

  const allUsers: SubUser[] = [
    {
      id: facility.user.id,
      email: facility.user.email,
      fullName: facility.user.fullName,
      jobTitle: facility.user.jobTitle,
      active: facility.user.active,
      isMainUser: true,
    },
    ...facility.subUsers.map(u => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      jobTitle: u.jobTitle,
      active: u.active,
      isMainUser: false,
    }))
  ];

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold mb-2">Einstellungen</h1>
        <p className="text-muted-foreground">Verwalten Sie Ihr Konto und die Zugänge für Ihre Einrichtung.</p>
      </div>

      <div className="grid gap-8">
        <section>
          <h2 className="text-lg font-medium mb-4">Mein Konto</h2>
          <ClientProfileForm userId={actor.id} email={actor.email} />
        </section>

        <section>
          <SubUsersSection users={allUsers} isMainUser={isMainUser} />
        </section>
      </div>
    </div>
  );
}
