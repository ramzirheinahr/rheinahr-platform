import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const params = await props.params;
    const user = await getCurrentUser();
    
    if (!user || !roleSatisfies(user.role, ["admin"])) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;
    
    if (!file) {
      return new NextResponse("No file uploaded", { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Save to public/uploads/contracts directory
    const filename = `rahmenvertrag_${params.id}_${Date.now()}.pdf`;
    const filepath = path.join(process.cwd(), "public/uploads/contracts", filename);
    await writeFile(filepath, buffer);

    const fileUrl = `/uploads/contracts/${filename}`;

    const client = await prisma.client.update({
      where: { id: params.id },
      data: {
        frameworkAgreementUrl: fileUrl,
        frameworkAgreementSignedAt: new Date()
      }
    });

    await audit({
      userId: user.id,
      action: "client.rahmenvertrag.upload",
      entity: "Client",
      entityId: client.id,
      metadata: { fileUrl }
    });

    return NextResponse.json({ success: true, url: fileUrl });
  } catch (error) {
    console.error("Upload error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
