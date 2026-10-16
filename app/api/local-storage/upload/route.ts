import { NextResponse } from "next/server";
import { verifyStorageToken, writeStorageObject } from "@/lib/local-storage";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    const capability = verifyStorageToken(token, "upload");
    const limit = capability.bucket === "system-assets" ? 10 * 1024 * 1024 : 25 * 1024 * 1024;
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > limit) return new NextResponse("File too large", { status: 413 });
    const content = await request.arrayBuffer();
    if (content.byteLength === 0 || content.byteLength > limit) return new NextResponse("Invalid file size", { status: 413 });
    await writeStorageObject(capability.bucket, capability.path, content, {
      upsert: capability.upsert,
      contentType: request.headers.get("content-type") || undefined,
    });
    return NextResponse.json({ path: capability.path });
  } catch (error) {
    const status = error instanceof Error && error.message.includes("EEXIST") ? 409 : 400;
    return new NextResponse("Invalid upload", { status });
  }
}
