const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany({
    where: { loginToken: { not: null } },
    select: { email: true, loginToken: true, loginPinHash: true, active: true }
  });
  console.log('Users with loginToken:', users);
}
check().finally(() => prisma.$disconnect());
