// Create the initial local super administrator only when no account exists.
// Usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run db:seed
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!email || !password || password.length < 12) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) are required");
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.log("Admin account already exists; no credentials were changed.");
  } else {
    await prisma.user.create({
      data: {
        id: randomUUID(),
        email,
        role: "super_admin",
        fullName: "Super Admin",
        passwordHash: await bcrypt.hash(password, 12),
      },
    });
    console.log("Local admin account created.");
  }
} catch (error) {
  console.error("Admin creation failed:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
