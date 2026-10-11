import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSyntheticSeedTarget, assertSyntheticDatabaseIdentity } from "./phase07c-seed-safety.mjs";

// Validate environment before constructing a client, opening a connection, or writing.
const targetUrl = assertSyntheticSeedTarget(process.env);
const prisma = new PrismaClient({ datasources: { db: { url: targetUrl } } });

async function assertEmptyIsolatedDatabase() {
  const identities = await prisma.$queryRaw`
    SELECT current_database() AS database,
           current_user AS "user",
           host(inet_server_addr()) AS address,
           inet_server_port() AS port
  `;
  if (identities.length !== 1) throw new Error("Could not verify synthetic database identity.");
  assertSyntheticDatabaseIdentity(identities[0]);

  // This seed is one-shot. Existing application data, even synthetic data, must
  // never be removed or silently replaced by a repeat run.
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (!tables.length) throw new Error("Synthetic database schema is missing.");
  for (const { tablename } of tables) {
    const quoted = `"${tablename.replaceAll('"', '""')}"`;
    const rows = await prisma.$queryRawUnsafe(`SELECT 1 FROM public.${quoted} LIMIT 1`);
    if (rows.length) throw new Error("Synthetic database is not empty; create a fresh isolated database.");
  }
}

async function main() {
  await assertEmptyIsolatedDatabase();
  console.log("Seeding synthetic test fixtures for Phase 07c Operational Acceptance...");

  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/phase07c-stundennachweis.pdf");
  const fixtureBytes = fs.readFileSync(fixture);
  if (fixtureBytes.length < 100 || fixtureBytes.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("Synthetic evidence PDF fixture is invalid.");
  }
  const evidenceFiles = [
    "storage/confirmations/cli-1/asg-wf-1/stundennachweis_scan.pdf",
    "storage/confirmations/cli-1/asg-wf-2/stundennachweis_becker.pdf",
  ];
  for (const destination of evidenceFiles) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, fixtureBytes, { flag: "wx" });
  }

  // 1. Users
  const adminUser = await prisma.user.create({
    data: {
      id: "usr-admin-1",
      email: "admin@rheinahr-test.de",
      role: "admin",
      fullName: "Max Admin",
      passwordHash: "dummy_hash_for_test",
      permissions: ["invoicing", "reports", "orders", "workers", "clients"],
    },
  });

  const clientUser = await prisma.user.create({
    data: {
      id: "usr-client-1",
      email: "leitung@kurpark-test.de",
      role: "client",
      fullName: "Frau Schmidt",
      passwordHash: "dummy_hash_for_test",
    },
  });

  const clientUser2 = await prisma.user.create({
    data: {
      id: "usr-client-2",
      email: "leitung@residenz-test.de",
      role: "client",
      fullName: "Herr Meyer",
      passwordHash: "dummy_hash_for_test",
    },
  });

  const workerUser1 = await prisma.user.create({
    data: {
      id: "usr-worker-1",
      email: "mustermann@rheinahr-test.de",
      role: "worker",
      fullName: "Max Mustermann",
      passwordHash: "dummy_hash_for_test",
    },
  });

  const workerUser2 = await prisma.user.create({
    data: {
      id: "usr-worker-2",
      email: "becker@rheinahr-test.de",
      role: "worker",
      fullName: "Anna Becker",
      passwordHash: "dummy_hash_for_test",
    },
  });

  // Sessions for cookie-based authentication
  await prisma.userSession.createMany({
    data: [
      {
        id: "sess-admin-1",
        token: "admin_test_session_token",
        userId: adminUser.id,
      },
      {
        id: "sess-client-1",
        token: "client_test_session_token",
        userId: clientUser.id,
      },
      {
        id: "sess-worker-1",
        token: "worker_test_session_token",
        userId: workerUser1.id,
      },
      {
        id: "sess-worker-2",
        token: "worker2_test_session_token",
        userId: workerUser2.id,
      },
    ],
  });

  // 2. Clients
  const client1 = await prisma.client.create({
    data: {
      id: "cli-1",
      facilityName: "Seniorenheim am Kurpark",
      shortCode: "SAK",
      internalNumber: "1001",
      facilityType: "Pflegeheim",
      address: "Kurparkstr. 12, 53474 Bad Neuenahr",
      billingEmail: "rechnung@kurpark-test.de",
      paymentTermsDays: 14,
      userId: clientUser.id,
    },
  });

  await prisma.user.update({
    where: { id: clientUser.id },
    data: { clientId: client1.id },
  });

  const client2 = await prisma.client.create({
    data: {
      id: "cli-2",
      facilityName: "Residenz RheinAhr",
      shortCode: "RRA",
      internalNumber: "1002",
      facilityType: "Seniorenresidenz",
      address: "Rheinweg 5, 53177 Bonn",
      billingEmail: "rechnung@residenz-test.de",
      paymentTermsDays: 14,
      userId: clientUser2.id,
    },
  });

  await prisma.user.update({
    where: { id: clientUser2.id },
    data: { clientId: client2.id },
  });

  // 3. Workers
  const worker1 = await prisma.worker.create({
    data: {
      id: "wrk-1",
      userId: workerUser1.id,
      fullName: "Max Mustermann",
      qualification: "Fachkraft",
      phone: "+49 228 123456",
      contractType: "unbefristet",
      employmentType: "vollzeit",
    },
  });

  const worker2 = await prisma.worker.create({
    data: {
      id: "wrk-2",
      userId: workerUser2.id,
      fullName: "Anna Becker",
      qualification: "Hilfskraft",
      phone: "+49 228 654321",
      contractType: "unbefristet",
      employmentType: "teilzeit",
    },
  });

  // 4. Invoices (Request 1 - Cancelled Invoices Tab & Active Invoices)
  await prisma.invoice.create({
    data: {
      id: "inv-act-1",
      invoiceNumber: "RE-2026-1001",
      status: "unpaid",
      netAmount: 500.0,
      vatAmount: 95.0,
      grossAmount: 595.0,
      date: new Date("2026-10-05T00:00:00Z"),
      clientId: client1.id,
    },
  });

  await prisma.invoice.create({
    data: {
      id: "inv-act-2",
      invoiceNumber: "RE-2026-1002",
      status: "paid",
      netAmount: 300.0,
      vatAmount: 57.0,
      grossAmount: 357.0,
      date: new Date("2026-10-06T00:00:00Z"),
      clientId: client1.id,
    },
  });

  await prisma.invoice.create({
    data: {
      id: "inv-canc-1",
      invoiceNumber: "RE-2026-STORNO-01",
      status: "cancelled",
      netAmount: 400.0,
      vatAmount: 76.0,
      grossAmount: 476.0,
      date: new Date("2026-10-08T00:00:00Z"),
      clientId: client1.id,
      snapshotData: {
        facilityName: "Seniorenheim am Kurpark (Historisch)",
        calculationVersion: "v2",
        items: [
          {
            pos: 1,
            description: "Pflegefachkraft",
            hoursDisplay: "8,00",
            rateDisplay: "50,00 €",
            amountDisplay: "400,00 €",
          },
        ],
        pdfItems: [
          {
            pos: 1,
            description: "Pflegefachkraft",
            hours: "8,00",
            rate: "50,00",
            amount: "400,00 €",
          },
        ],
      },
    },
  });

  await prisma.invoice.create({
    data: {
      id: "inv-canc-2",
      invoiceNumber: "RE-2026-STORNO-02",
      status: "cancelled",
      netAmount: 200.0,
      vatAmount: 38.0,
      grossAmount: 238.0,
      date: new Date("2026-10-09T00:00:00Z"),
      clientId: client2.id,
      snapshotData: null,
    },
  });

  // 5. Orders, Assignments & Evidence Workflows (Requests 2, 3, 4, 6)
  // Shift 1: Completed with Electronic confirmation + Proposed hours correction
  const order1 = await prisma.order.create({
    data: {
      id: "ord-wf-1",
      clientId: client1.id,
      shiftDate: new Date("2026-10-01T00:00:00Z"),
      startTime: "08:00",
      endTime: "16:30",
      breakMinutes: 30,
      status: "completed",
      requiredQualification: "Fachkraft",
      quantity: 1,
    },
  });

  const asg1 = await prisma.assignment.create({
    data: {
      id: "asg-wf-1",
      orderId: order1.id,
      workerId: worker1.id,
      status: "confirmed",
      confirmedAt: new Date("2026-10-01T16:30:00Z"),
    },
  });

  await prisma.serviceConfirmation.create({
    data: {
      id: "sc-orig-1",
      assignmentId: asg1.id,
      hoursWorked: 8.0,
      method: "electronic",
      signerName: "Fr. Schmidt (Original)",
      signatureData:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      confirmedAt: new Date("2026-10-01T16:30:00Z"),
    },
  });

  const doc1 = await prisma.confirmationDocument.create({
    data: {
      id: "doc-wf-1",
      assignmentId: asg1.id,
      sourceType: "manual_upload",
      storagePath: "storage/confirmations/cli-1/asg-wf-1/stundennachweis_scan.pdf",
      fileName: "Stundennachweis_Korrektur_Okt.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: fixtureBytes.length,
      uploadedById: adminUser.id,
      uploaderRole: "admin",
      createdAt: new Date("2026-10-02T09:00:00Z"),
    },
  });

  await prisma.workHoursCorrectionRequest.create({
    data: {
      id: "req-wf-1",
      assignmentId: asg1.id,
      documentId: doc1.id,
      status: "proposed",
      previousHoursWorked: 8.0,
      proposedHoursWorked: 6.5,
      proposedStartTime: "08:00",
      proposedEndTime: "15:00",
      proposedBreakMinutes: 30,
      reason: "Mitarbeiter verließ die Schicht vorzeitig",
      requestedById: adminUser.id,
      requestedAt: new Date("2026-10-02T10:00:00Z"),
    },
  });

  // Shift 2: Completed with Electronic confirmation + APPROVED hours correction
  const order2 = await prisma.order.create({
    data: {
      id: "ord-wf-2",
      clientId: client1.id,
      shiftDate: new Date("2026-10-02T00:00:00Z"),
      startTime: "08:00",
      endTime: "16:30",
      breakMinutes: 30,
      status: "completed",
      requiredQualification: "Fachkraft",
      quantity: 1,
    },
  });

  const asg2 = await prisma.assignment.create({
    data: {
      id: "asg-wf-2",
      orderId: order2.id,
      workerId: worker1.id,
      status: "confirmed",
      confirmedAt: new Date("2026-10-02T16:30:00Z"),
    },
  });

  await prisma.serviceConfirmation.create({
    data: {
      id: "sc-orig-2",
      assignmentId: asg2.id,
      hoursWorked: 8.0,
      method: "electronic",
      signerName: "Hr. Becker",
      signatureData:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      confirmedAt: new Date("2026-10-02T16:30:00Z"),
    },
  });

  const doc2 = await prisma.confirmationDocument.create({
    data: {
      id: "doc-wf-2",
      assignmentId: asg2.id,
      sourceType: "manual_upload",
      storagePath: "storage/confirmations/cli-1/asg-wf-2/stundennachweis_becker.pdf",
      fileName: "Stundennachweis_Becker_Genehmigt.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: fixtureBytes.length,
      uploadedById: adminUser.id,
      uploaderRole: "admin",
      createdAt: new Date("2026-10-03T09:00:00Z"),
    },
  });

  await prisma.workHoursCorrectionRequest.create({
    data: {
      id: "req-wf-2",
      assignmentId: asg2.id,
      documentId: doc2.id,
      status: "approved",
      revision: 1,
      previousHoursWorked: 8.0,
      proposedHoursWorked: 7.0,
      proposedStartTime: "08:00",
      proposedEndTime: "15:30",
      proposedBreakMinutes: 30,
      reason: "Halbe Stunde früher gegangen",
      requestedById: adminUser.id,
      requestedAt: new Date("2026-10-03T10:00:00Z"),
      decidedById: adminUser.id,
      decidedAt: new Date("2026-10-03T11:00:00Z"),
      decisionNote: "Genehmigt nach Prüfung",
    },
  });

  // 6. Overlapping Shifts (Request 5)
  // Worker 1 has overlapping shifts on 2026-10-15:
  // Shift A: 08:00–14:00 at Client 1
  // Shift B: 13:00–19:00 at Client 2 -> 1h overlap!
  const orderOverlapA = await prisma.order.create({
    data: {
      id: "ord-ov-1",
      clientId: client1.id,
      shiftDate: new Date("2026-10-15T00:00:00Z"),
      startTime: "08:00",
      endTime: "14:00",
      breakMinutes: 0,
      status: "confirmed",
      requiredQualification: "Fachkraft",
      quantity: 1,
    },
  });

  await prisma.assignment.create({
    data: {
      id: "asg-ov-1",
      orderId: orderOverlapA.id,
      workerId: worker1.id,
      status: "confirmed",
    },
  });

  const orderOverlapB = await prisma.order.create({
    data: {
      id: "ord-ov-2",
      clientId: client2.id,
      shiftDate: new Date("2026-10-15T00:00:00Z"),
      startTime: "13:00",
      endTime: "19:00",
      breakMinutes: 0,
      status: "confirmed",
      requiredQualification: "Fachkraft",
      quantity: 1,
    },
  });

  await prisma.assignment.create({
    data: {
      id: "asg-ov-2",
      orderId: orderOverlapB.id,
      workerId: worker1.id,
      status: "confirmed",
    },
  });

  // Touching shifts (Worker 2 on 2026-10-16): 08:00–14:00 and 14:00–20:00 -> 0 overlap!
  const orderTouchA = await prisma.order.create({
    data: {
      id: "ord-touch-1",
      clientId: client1.id,
      shiftDate: new Date("2026-10-16T00:00:00Z"),
      startTime: "08:00",
      endTime: "14:00",
      breakMinutes: 0,
      status: "confirmed",
      requiredQualification: "Hilfskraft",
      quantity: 1,
    },
  });

  await prisma.assignment.create({
    data: {
      id: "asg-touch-1",
      orderId: orderTouchA.id,
      workerId: worker2.id,
      status: "confirmed",
    },
  });

  const orderTouchB = await prisma.order.create({
    data: {
      id: "ord-touch-2",
      clientId: client2.id,
      shiftDate: new Date("2026-10-16T00:00:00Z"),
      startTime: "14:00",
      endTime: "20:00",
      breakMinutes: 0,
      status: "confirmed",
      requiredQualification: "Hilfskraft",
      quantity: 1,
    },
  });

  await prisma.assignment.create({
    data: {
      id: "asg-touch-2",
      orderId: orderTouchB.id,
      workerId: worker2.id,
      status: "confirmed",
    },
  });

  // 7. Future Planned Shift without confirmation (Request 6 - separating actual vs planned)
  const orderPlanned = await prisma.order.create({
    data: {
      id: "ord-plan-1",
      clientId: client1.id,
      shiftDate: new Date("2026-10-25T00:00:00Z"),
      startTime: "08:00",
      endTime: "16:30",
      breakMinutes: 30,
      status: "assigned",
      requiredQualification: "Fachkraft",
      quantity: 1,
    },
  });

  await prisma.assignment.create({
    data: {
      id: "asg-plan-1",
      orderId: orderPlanned.id,
      workerId: worker1.id,
      status: "confirmed",
    },
  });

  console.log("Synthetic seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
