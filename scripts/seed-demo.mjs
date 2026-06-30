// Demo data seed — populates a realistic, end-to-end scenario for showcasing the
// platform. Idempotent: wipes all non-super_admin data first, then recreates.
// Usage: node --env-file=.env scripts/seed-demo.mjs
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const SUPER_ADMIN = "admin@rheinahr-gmbh.de";
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const prisma = new PrismaClient();
const d = (s) => new Date(`${s}T00:00:00.000Z`);
const hash = async (p) => bcrypt.hash(p, 10);

async function cleanup() {
  // Delete in dependency order (the confirmedBy FK is SetNull, not cascade).
  await prisma.serviceConfirmation.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.workerAvailability.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.worker.deleteMany({});
  await prisma.client.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.user.deleteMany({ where: { email: { not: SUPER_ADMIN } } });
  // Remove their Supabase Auth logins.
  const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const u of data.users) {
    if (u.email && u.email !== SUPER_ADMIN) await sb.auth.admin.deleteUser(u.id).catch(() => {});
  }
}

// Prisma-only user (background actor; no login needed).
async function bgUser(email, role, fullName) {
  const u = await prisma.user.create({
    data: { email, role, fullName, passwordHash: await hash(`bg-${Math.random()}`) },
  });
  return u.id;
}

// Real login account: Supabase Auth + matching Prisma user (same id).
async function loginUser(email, role, fullName, password) {
  const { data, error } = await sb.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { role },
  });
  if (error) throw error;
  await prisma.user.create({
    data: { id: data.user.id, email, role, fullName, passwordHash: await hash(password) },
  });
  return data.user.id;
}

async function main() {
  await cleanup();

  // ── Login accounts the owner can try ──
  const clientUid = await loginUser(
    "client.demo@demo.rheinahr-gmbh.de", "client", "Seniorenresidenz Rheinaue", "Demo!Klinik2026",
  );
  const workerUid = await loginUser(
    "worker.demo@demo.rheinahr-gmbh.de", "worker", "Layla Hassan", "Demo!Pflege2026",
  );

  const demoClient = await prisma.client.create({
    data: { userId: clientUid, facilityName: "Seniorenresidenz Rheinaue", facilityType: "seniorenheim",
      address: "Bonner Talweg 12, 53113 Bonn", contactPerson: "Frau Dr. Neumann" },
  });
  const layla = await prisma.worker.create({
    data: { userId: workerUid, fullName: "Layla Hassan", qualification: "pflegefachkraft",
      contractType: "unbefristet", phone: "0151 2345678", languages: ["de", "ar"],
      certifications: ["Examen Pflegefachkraft", "Basale Stimulation"] },
  });

  // ── Background facilities ──
  const c1 = await prisma.client.create({
    data: { userId: await bgUser("rheinblick@demo.rheinahr-gmbh.de", "client", "Seniorenheim Rheinblick"),
      facilityName: "Seniorenheim Rheinblick", facilityType: "pflegeheim",
      address: "Rheinaustr. 5, 53225 Bonn", contactPerson: "Herr Klein" },
  });
  const c2 = await prisma.client.create({
    data: { userId: await bgUser("rheinpflege@demo.rheinahr-gmbh.de", "client", "Ambulanter Dienst RheinPflege"),
      facilityName: "Ambulanter Dienst RheinPflege", facilityType: "ambulant",
      address: "Parkstr. 30, 53111 Bonn", contactPerson: "Frau Hofmann" },
  });

  // ── Background workforce (varied qualifications) ──
  const mk = async (email, name, qual, contract) =>
    (await prisma.worker.create({ data: {
      userId: await bgUser(email, "worker", name), fullName: name,
      qualification: qual, contractType: contract, languages: ["de"] } })).id;
  const w = {
    anna: await mk("anna@demo.rheinahr-gmbh.de", "Anna Müller", "pflegefachkraft", "unbefristet"),
    thomas: await mk("thomas@demo.rheinahr-gmbh.de", "Thomas Schmidt", "altenpfleger", "befristet"),
    sarah: await mk("sarah@demo.rheinahr-gmbh.de", "Dr. Sarah Wagner", "pflegedienstleitung", "unbefristet"),
    mehmet: await mk("mehmet@demo.rheinahr-gmbh.de", "Mehmet Yılmaz", "betreuungskraft", "unbefristet"),
    julia: await mk("julia@demo.rheinahr-gmbh.de", "Julia Becker", "gesundheitspfleger", "minijob"),
    omar: await mk("omar@demo.rheinahr-gmbh.de", "Omar Khalil", "pflegehelfer", "befristet"),
  };

  // Some availability blocks (show the calendar + affect matching).
  await prisma.workerAvailability.createMany({ data: [
    { workerId: layla.id, date: d("2026-07-20"), status: "unavailable" },
    { workerId: w.anna, date: d("2026-07-05"), status: "unavailable" },
  ]});

  // helper to create an order (+ optional assignment + service confirmation)
  async function order(clientId, qual, date, start, end, status, opts = {}) {
    const o = await prisma.order.create({ data: {
      clientId, requiredQualification: qual, shiftDate: d(date),
      startTime: start, endTime: end, quantity: 1, status, notes: opts.notes ?? null } });
    if (opts.assign) {
      const a = await prisma.assignment.create({ data: {
        orderId: o.id, workerId: opts.assign, status: opts.assignStatus ?? "pending",
        confirmedAt: opts.assignStatus === "confirmed" ? new Date() : null } });
      if (opts.hours) {
        await prisma.serviceConfirmation.create({ data: {
          assignmentId: a.id, confirmedById: opts.confirmedBy, method: "electronic",
          hoursWorked: opts.hours, ipAddress: "84.183.10.22" } });
      }
    }
    return o;
  }

  // ── Orders across the lifecycle ──
  await order(demoClient.id, "pflegefachkraft", "2026-07-15", "08:00", "16:00", "pending",
    { notes: "Vertretung Station 3" });
  await order(demoClient.id, "pflegedienstleitung", "2026-07-08", "09:00", "17:00", "assigned",
    { assign: w.sarah, assignStatus: "pending" });
  // Owner can ACCEPT this one in the worker portal (Layla):
  await order(demoClient.id, "pflegefachkraft", "2026-07-10", "07:00", "15:00", "assigned",
    { assign: layla.id, assignStatus: "pending" });
  // Confirmed + service-confirmed (history / reports / invoicing):
  await order(demoClient.id, "betreuungskraft", "2026-06-20", "08:00", "20:00", "confirmed",
    { assign: w.mehmet, assignStatus: "confirmed", hours: 12, confirmedBy: clientUid });
  await order(c1.id, "altenpfleger", "2026-06-22", "06:00", "14:00", "confirmed",
    { assign: w.thomas, assignStatus: "confirmed", hours: 8,
      confirmedBy: (await prisma.client.findUniqueOrThrow({ where: { id: c1.id }, select: { userId: true } })).userId });
  // Layla's completed shift (worker history):
  await order(c2.id, "pflegefachkraft", "2026-06-25", "14:00", "22:00", "confirmed",
    { assign: layla.id, assignStatus: "confirmed", hours: 8,
      confirmedBy: (await prisma.client.findUniqueOrThrow({ where: { id: c2.id }, select: { userId: true } })).userId });
  await order(c1.id, "gesundheitspfleger", "2026-07-12", "08:00", "16:00", "review");
  // Completed, worker confirmed, awaiting the client's service confirmation
  // (owner can confirm LIVE with the signature pad):
  await order(demoClient.id, "pflegehelfer", "2026-06-28", "08:00", "16:00", "completed",
    { assign: w.omar, assignStatus: "confirmed" });

  // ── A few in-app notifications so the bell is alive ──
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: SUPER_ADMIN }, select: { id: true } });
  await prisma.notification.createMany({ data: [
    { userId: admin.id, type: "new_order", channel: "in_app", content: "Seniorenresidenz Rheinaue: 2026-07-15 08:00–16:00" },
    { userId: admin.id, type: "service_confirmed", channel: "in_app", content: "12h" },
    { userId: workerUid, type: "worker_assigned", channel: "in_app", content: "2026-07-10 07:00–15:00" },
    { userId: clientUid, type: "worker_confirmed", channel: "in_app", content: "Mehmet Yılmaz: 2026-06-20" },
  ]});

  const [wc, cc, oc, ac, scc] = await Promise.all([
    prisma.worker.count(), prisma.client.count(), prisma.order.count(),
    prisma.assignment.count(), prisma.serviceConfirmation.count(),
  ]);
  console.log("✅ Demo seeded:");
  console.log(`   workers=${wc} clients=${cc} orders=${oc} assignments=${ac} confirmations=${scc}`);
  console.log("\n   Login accounts:");
  console.log("   • Admin   : admin@rheinahr-gmbh.de / RheinAhr#2026!Admin");
  console.log("   • Client  : client.demo@demo.rheinahr-gmbh.de / Demo!Klinik2026");
  console.log("   • Worker  : worker.demo@demo.rheinahr-gmbh.de / Demo!Pflege2026");
}

try {
  await main();
} catch (e) {
  console.error("SEED FAILED:", e.message || e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
