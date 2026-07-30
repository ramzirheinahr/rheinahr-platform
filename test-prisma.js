const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const orders = await prisma.order.findMany({
      where: { requestGroupId: "test" },
      orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
      include: {
        client: {
          select: {
            facilityName: true,
            address: true,
            surchargeSat: true,
            surchargeSun: true,
            surchargeHoliday: true,
            surchargeNight: true,
            nightStart: true,
            nightEnd: true,
            hourlyRates: true,
          },
        },
        assignments: {
          include: {
            worker: { select: { id: true, fullName: true, phone: true, photoPath: true, mealAllowanceEnabled: true, travelAllowanceEnabled: true } },
            serviceConfirmation: { select: { hoursWorked: true, correctionHours: true, method: true } },
          },
        },
      },
    });
    console.log("Success");
  } catch (e) {
    console.error(e.message);
  } finally {
    await prisma.$disconnect();
  }
}
main();
