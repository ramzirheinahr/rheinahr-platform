import { NextResponse } from "next/server";
import { readStorageObject, storageContentType } from "@/lib/local-storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path;
  if (parts[0] !== "system-assets" || parts.length < 2) return new NextResponse("Not found", { status: 404 });
  const objectPath = parts.slice(1).join("/");
  try {
    const content = await readStorageObject("system-assets", objectPath);
    const mime = storageContentType(objectPath);
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(new Uint8Array(content), {
      headers: { "Content-Type": mime, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
