// One-off (2026-11-06): access links became single-use in 1b41455, but links that
// were already used before that still work once more. This clears them.
// Links never used (no access.link.success after their latest generate) are kept.
// Existing sessions are NOT touched — nobody is signed out.
//
// Run inside a deployed app dir (its .env picks the company database):
//   node --env-file=.env scripts/revoke-used-access-links.mjs          # dry run
//   node --env-file=.env scripts/revoke-used-access-links.mjs --apply
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

try {
  const withLink = await prisma.user.findMany({
    where: { loginToken: { not: null } },
    select: { id: true, loginToken: true },
  });
  const ids = withLink.map((u) => u.id);
  const events = await prisma.auditLog.findMany({
    where: {
      entityId: { in: ids },
      action: { in: ["account.access_link.generate", "access.link.success"] },
    },
    select: { entityId: true, action: true, createdAt: true },
  });

  const latest = (id, action) =>
    events
      .filter((e) => e.entityId === id && e.action === action)
      .reduce((max, e) => (max && max > e.createdAt ? max : e.createdAt), null);

  const used = withLink.filter((u) => {
    const generated = latest(u.id, "account.access_link.generate");
    const signedIn = latest(u.id, "access.link.success");
    return signedIn && (!generated || signedIn > generated);
  });

  console.log(`links active: ${withLink.length}, already used: ${used.length}, kept (unused): ${withLink.length - used.length}`);
  if (!apply) {
    console.log("dry run — nothing changed (pass --apply)");
  } else {
    const cleared = await prisma.$transaction(async (tx) => {
      let count = 0;
      for (const u of used) {
        // Match the token we inspected, so a link regenerated meanwhile survives.
        const res = await tx.user.updateMany({
          where: { id: u.id, loginToken: u.loginToken },
          data: { loginToken: null },
        });
        if (res.count === 1) {
          count++;
          await tx.auditLog.create({
            data: {
              userId: null,
              action: "account.access_link.revoke",
              entity: "User",
              entityId: u.id,
              metadata: { reason: "already_used_before_single_use_links" },
            },
          });
        }
      }
      return count;
    });
    console.log(`revoked: ${cleared}`);
  }
} finally {
  await prisma.$disconnect();
}
