import { NextResponse } from "next/server";
import { readStorageObject, storageContentType, verifyStorageToken } from "@/lib/local-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    const capability = verifyStorageToken(token, "download");
    const content = await readStorageObject(capability.bucket, capability.path);
    return new NextResponse(new Uint8Array(content), {
      headers: {
        "Content-Type": storageContentType(capability.path),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
