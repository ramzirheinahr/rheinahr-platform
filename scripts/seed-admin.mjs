// Creates the initial admin: a Supabase Auth user + a matching Prisma User row
// (same id, role=admin). Idempotent — safe to re-run.
//
// Usage:
//   node --env-file=.env scripts/seed-admin.mjs [email] [password]
// Falls back to ADMIN_EMAIL / ADMIN_PASSWORD env vars, then to defaults.

import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const email = process.argv[2] || process.env.ADMIN_EMAIL || "admin@rheinahr-gmbh.de";
const password =
  process.argv[3] || process.env.ADMIN_PASSWORD || "RheinAhr#2026!Admin";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const prisma = new PrismaClient();

async function findAuthUserByEmail(targetEmail) {
  // Page through the admin user list to find an existing account.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === targetEmail.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

try {
  let authUser = await findAuthUserByEmail(email);

  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // skip confirmation email so login works immediately
      user_metadata: { role: "admin" },
    });
    if (error) throw error;
    authUser = data.user;
    console.log("Created Supabase Auth user:", authUser.id);
  } else {
    // Ensure the password is set to the known value.
    await supabase.auth.admin.updateUserById(authUser.id, { password });
    console.log("Supabase Auth user already existed:", authUser.id);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { id: authUser.id },
    update: { role: "super_admin", email, active: true },
    create: {
      id: authUser.id,
      email,
      role: "super_admin",
      fullName: "Super Admin",
      passwordHash,
    },
  });

  console.log("\n✅ Admin ready");
  console.log("   email:   ", email);
  console.log("   password:", password);
} catch (e) {
  console.error("Seed failed:", e.message || e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
