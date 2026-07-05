// One-time: add the tables the live portals watch to the Supabase Realtime
// publication (`supabase_realtime`). Idempotent — skips tables already in it.
// Realtime streams row changes over the existing logical-replication slot, so
// the live updates cost far less than polling. Re-runnable safely.
//
//   node scripts/enable-realtime.mjs
import { PrismaClient } from "@prisma/client";

const TABLES = [
  "notifications",
  "messages",
  "orders",
  "assignments",
  "worker_availability",
  "leave_requests",
  "leave_days",
  "service_confirmations",
];

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.$queryRawUnsafe(
    "select tablename from pg_publication_tables where pubname = 'supabase_realtime'",
  );
  const have = new Set(existing.map((r) => r.tablename));

  for (const table of TABLES) {
    if (have.has(table)) {
      console.log(`= ${table} (already enabled)`);
      continue;
    }
    // Table/identifier is from our own constant list — safe to interpolate.
    await prisma.$executeRawUnsafe(
      `alter publication supabase_realtime add table public."${table}"`,
    );
    console.log(`+ ${table} (enabled)`);
  }
  console.log("Realtime publication is up to date.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
