import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const BUCKETS = new Set(["confirmations", "worker-files", "system-assets"]);
const PRIVATE_MAX_BYTES = 25 * 1024 * 1024;
const PUBLIC_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_TTL_SECONDS = 10 * 60;

type Result<T> = { data: T; error: null } | { data: null; error: Error };
type UploadBody = ArrayBuffer | ArrayBufferView | Blob | Buffer;

function secret(): string {
  const value = process.env.LOCAL_STORAGE_SECRET;
  if (!value || value.length < 32) throw new Error("LOCAL_STORAGE_SECRET must be at least 32 characters");
  return value;
}

function root(): string {
  const configured = process.env.LOCAL_STORAGE_DIR;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("LOCAL_STORAGE_DIR is required in production");
  }
  return path.resolve(configured || path.join(process.cwd(), ".local-storage"));
}

export function storagePath(bucket: string, objectPath: string): string {
  if (!BUCKETS.has(bucket)) throw new Error("Invalid storage bucket");
  const clean = objectPath.replace(/^\/+/, "");
  const parts = clean.split("/");
  if (
    !clean || clean.length > 1024 ||
    parts.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.includes("\0"))
  ) throw new Error("Invalid storage path");
  return path.join(root(), bucket, ...parts);
}

function normalizedPath(bucket: string, objectPath: string): string {
  // A few historical rows include the bucket prefix in addition to the key.
  return objectPath.replace(/^\/+/, "").replace(new RegExp(`^${bucket}/`), "");
}

async function safeFile(bucket: string, objectPath: string): Promise<string> {
  const candidate = storagePath(bucket, normalizedPath(bucket, objectPath));
  const canonicalRoot = await fs.realpath(root());
  const canonical = await fs.realpath(candidate);
  if (!canonical.startsWith(canonicalRoot + path.sep)) throw new Error("Storage path escaped root");
  const stat = await fs.stat(canonical);
  if (!stat.isFile()) throw new Error("Storage object is not a file");
  return canonical;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

type Capability = { action: "upload" | "download"; bucket: string; path: string; expires: number; upsert?: boolean };

function makeToken(capability: Capability): string {
  const payload = Buffer.from(JSON.stringify(capability)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyStorageToken(token: string, action: Capability["action"]): Capability {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Invalid storage token");
  const expected = Buffer.from(sign(parts[0]));
  const supplied = Buffer.from(parts[1]);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error("Invalid storage token");
  }
  const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as Capability;
  if (payload.action !== action || !Number.isSafeInteger(payload.expires) || payload.expires < Date.now()) {
    throw new Error("Expired storage token");
  }
  storagePath(payload.bucket, payload.path);
  return payload;
}

async function bytes(body: UploadBody): Promise<Buffer> {
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}

export async function writeStorageObject(
  bucket: string,
  objectPath: string,
  body: UploadBody,
  options: { upsert?: boolean; contentType?: string } = {},
): Promise<void> {
  const destination = storagePath(bucket, objectPath);
  const content = await bytes(body);
  const limit = bucket === "system-assets" ? PUBLIC_MAX_BYTES : PRIVATE_MAX_BYTES;
  if (content.length === 0 || content.length > limit) throw new Error("Invalid storage object size");
  if (bucket === "system-assets") {
    const mime = options.contentType || "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("Invalid public asset type");
  }
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const canonicalRoot = await fs.realpath(root());
  const parent = await fs.realpath(path.dirname(destination));
  if (!parent.startsWith(canonicalRoot + path.sep)) throw new Error("Storage path escaped root");
  const temp = `${destination}.${randomBytes(12).toString("hex")}.tmp`;
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (!options.upsert) {
      // link() is exclusive: unlike rename(), it cannot replace an existing object.
      await fs.link(temp, destination);
      await fs.unlink(temp);
    } else {
      await fs.rename(temp, destination);
    }
  } catch (error) {
    await fs.unlink(temp).catch(() => {});
    throw error;
  }
}

export async function readStorageObject(bucket: string, objectPath: string): Promise<Buffer> {
  return fs.readFile(await safeFile(bucket, objectPath));
}

export function storageContentType(objectPath: string): string {
  const ext = path.extname(objectPath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function failure<T>(error: unknown): Result<T> {
  return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
}

export function createLocalStorageClient() {
  return {
    storage: {
      from(bucket: string) {
        return {
          async upload(objectPath: string, body: UploadBody, options?: { contentType?: string; upsert?: boolean }) {
            try {
              await writeStorageObject(bucket, objectPath, body, options);
              return { data: { path: objectPath }, error: null };
            } catch (error) { return failure<{ path: string }>(error); }
          },
          async download(objectPath: string): Promise<Result<Blob>> {
            try {
              const content = await readStorageObject(bucket, objectPath);
              return { data: new Blob([new Uint8Array(content)], { type: storageContentType(objectPath) }), error: null };
            } catch (error) { return failure<Blob>(error); }
          },
          async remove(paths: string[]): Promise<Result<{ name: string }[]>> {
            try {
              const deleted: { name: string }[] = [];
              for (const objectPath of paths) {
                const file = await safeFile(bucket, objectPath).catch(() => null);
                if (file) {
                  await fs.unlink(file);
                  deleted.push({ name: path.basename(objectPath) });
                }
              }
              return { data: deleted, error: null };
            } catch (error) { return failure<{ name: string }[]>(error); }
          },
          async list(prefix = "", options?: { search?: string; limit?: number }): Promise<Result<{ name: string }[]>> {
            try {
              const directory = prefix ? storagePath(bucket, `${prefix}/placeholder`) : storagePath(bucket, "placeholder");
              const parent = path.dirname(directory);
              const canonicalRoot = await fs.realpath(root());
              const canonical = await fs.realpath(parent).catch(() => null);
              if (!canonical) return { data: [], error: null };
              if (!canonical.startsWith(canonicalRoot + path.sep)) throw new Error("Storage path escaped root");
              const names = (await fs.readdir(canonical, { withFileTypes: true }))
                .filter((entry) => entry.isFile() && (!options?.search || entry.name.includes(options.search)))
                .slice(0, options?.limit ?? 100)
                .map((entry) => ({ name: entry.name }));
              return { data: names, error: null };
            } catch (error) { return failure<{ name: string }[]>(error); }
          },
          async createSignedUploadUrl(objectPath: string, options?: { upsert?: boolean }) {
            try {
              storagePath(bucket, objectPath);
              const token = makeToken({ action: "upload", bucket, path: objectPath, expires: Date.now() + UPLOAD_TTL_SECONDS * 1000, upsert: options?.upsert === true });
              return { data: { path: objectPath, token, signedUrl: `/api/local-storage/upload?token=${encodeURIComponent(token)}` }, error: null };
            } catch (error) { return failure<{ path: string; token: string; signedUrl: string }>(error); }
          },
          async createSignedUrl(objectPath: string, seconds: number) {
            try {
              await safeFile(bucket, objectPath);
              const expires = Date.now() + Math.min(Math.max(seconds, 1), 3600) * 1000;
              const token = makeToken({ action: "download", bucket, path: objectPath, expires });
              return { data: { signedUrl: `/api/local-storage/object?token=${encodeURIComponent(token)}` }, error: null };
            } catch (error) { return failure<{ signedUrl: string }>(error); }
          },
          getPublicUrl(objectPath: string) {
            storagePath(bucket, objectPath);
            if (bucket !== "system-assets") throw new Error("Only system assets are public");
            return { data: { publicUrl: `/api/local-storage/public/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}` } };
          },
        };
      },
    },
  };
}
