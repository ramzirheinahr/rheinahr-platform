import { sendEmailToUsers } from './lib/email';
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'super_admin' } })
  if (admin) {
    console.log("Found admin:", admin.email, "receiveEmails:", admin.receiveEmails)
    await sendEmailToUsers([admin.id], { subject: "Test", body: "Test body" })
    console.log("Email sent function finished.")
  } else {
    console.log("No admin found")
  }
}
main().finally(() => prisma.$disconnect())
