const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

async function test() {
  const client = await prisma.client.findFirst({ include: { user: true } });
  if (!client) { console.log('no client'); return; }
  
  const token = crypto.randomBytes(24).toString("base64url");
  const pinHash = "test_hash";
  
  await prisma.user.update({
    where: { id: client.userId },
    data: { loginToken: token, loginPinHash: pinHash, loginPinAttempts: 0, loginPinLockUntil: null }
  });
  
  console.log('token:', token);
  
  const account = await prisma.user.findUnique({
    where: { loginToken: token }
  });
  console.log('found account:', account ? account.email : 'null');
}
test().catch(console.error).finally(() => prisma.$disconnect());
