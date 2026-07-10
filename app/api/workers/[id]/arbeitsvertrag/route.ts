import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateArbeitsvertragPdf, ArbeitsvertragData } from "@/lib/pdf/arbeitsvertrag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const worker = await prisma.worker.findUnique({
    where: { id: params.id }
  });

  if (!worker) return new NextResponse("Not found", { status: 404 });

  // Compute the hourly rate based on qualification and custom rates
  const baseRates = { pflegefachkraft: 28, pflegehelfer: 17, betreuungskraft: 19, pflegedienstleitung: 32 };
  const customRates = (worker.hourlyRates as Record<string, number> | null) || {};
  const hourlyRate = customRates[worker.qualification] || baseRates[worker.qualification as keyof typeof baseRates] || 17;

  const pdfData: ArbeitsvertragData = {
    fullName: worker.fullName,
    address: worker.address || "Adresse unbekannt",
    contractType: worker.contractType,
    startDate: worker.employmentStartDate,
    endDate: worker.employmentEndDate,
    qualification: worker.qualification,
    requiredHours: worker.requiredHours,
    hourlyRate,
    createdAt: new Date(),
  };

  const pdfBuffer = await generateArbeitsvertragPdf(pdfData);

  await audit({
    userId: user.id,
    action: "worker.arbeitsvertrag.generate",
    entity: "Worker",
    entityId: worker.id
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Arbeitsvertrag-${worker.fullName.replace(/\s+/g, "_")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
