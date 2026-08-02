import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

    const filename = `rahmenvertrag_${params.id}_${Date.now()}.pdf`;

    const supabase = createSupabaseAdminClient();
    const { error: uploadError } = await supabase.storage
      .from("confirmations")
      .upload(filename, buffer, {
        contentType: file.type || "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      throw uploadError;
    }

    const client = await prisma.client.update({
      where: { id: params.id },
      data: {
        frameworkAgreementUrl: filename,
        frameworkAgreementSignedAt: new Date()
      }
    });

    await audit({
      userId: user.id,
      action: "client.rahmenvertrag.upload",
      entity: "Client",
      entityId: client.id,
      metadata: { fileUrl: filename }
    });

    return NextResponse.json({ success: true, url: filename });
  } catch (error) {
    console.error("Upload error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
