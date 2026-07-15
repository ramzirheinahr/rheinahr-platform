import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  try {
    const users = await prisma.user.findMany({ where: { receiveEmails: true } })
    console.log("Success, found users:", users.length)
  } catch (e) {
    console.error("Prisma Error:", e.message)
  }
}
main().finally(() => prisma.$disconnect())
