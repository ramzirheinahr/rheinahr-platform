import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

import { createLocalStorageClient, readStorageObject, verifyStorageToken, writeStorageObject } from "./local-storage";

let directory: string;
let originalDirectory: string | undefined;
let originalSecret: string | undefined;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "rheinahr-storage-"));
  originalDirectory = process.env.LOCAL_STORAGE_DIR;
  originalSecret = process.env.LOCAL_STORAGE_SECRET;
  process.env.LOCAL_STORAGE_DIR = directory;
  process.env.LOCAL_STORAGE_SECRET = "integration-test-secret-with-more-than-32-characters";
});

afterEach(async () => {
  if (originalDirectory === undefined) delete process.env.LOCAL_STORAGE_DIR;
  else process.env.LOCAL_STORAGE_DIR = originalDirectory;
  if (originalSecret === undefined) delete process.env.LOCAL_STORAGE_SECRET;
  else process.env.LOCAL_STORAGE_SECRET = originalSecret;
  await rm(directory, { recursive: true, force: true });
});

describe("local document storage", () => {
  it("writes a document once, reads exact bytes, and refuses accidental replacement", async () => {
    const object = createLocalStorageClient().storage.from("confirmations");
    const source = Buffer.from("%PDF-1.7\nimportant original bytes");
    expect((await object.upload("contracts/123/original.pdf", source)).error).toBeNull();
    expect((await object.upload("contracts/123/original.pdf", Buffer.from("replacement"))).error).toBeTruthy();
    expect(await readStorageObject("confirmations", "contracts/123/original.pdf")).toEqual(source);
    const listed = await object.list("contracts/123", { search: "original", limit: 10 });
    expect(listed.data).toEqual([{ name: "original.pdf" }]);
  });

  it("binds short-lived upload and download capabilities to the operation and rejects tampering", async () => {
    const object = createLocalStorageClient().storage.from("worker-files");
    const ticket = await object.createSignedUploadUrl("photos/worker-1/image.png");
    expect(ticket.error).toBeNull();
    const token = ticket.data!.token;
    expect(verifyStorageToken(token, "upload").path).toBe("photos/worker-1/image.png");
    expect(() => verifyStorageToken(token, "download")).toThrow();
    expect(() => verifyStorageToken(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"), "upload")).toThrow();
    await writeStorageObject("worker-files", "photos/worker-1/image.png", new Uint8Array([137, 80, 78, 71]));
    const link = await object.createSignedUrl("photos/worker-1/image.png", 60);
    expect(link.error).toBeNull();
    const downloadToken = new URL(link.data!.signedUrl, "https://example.invalid").searchParams.get("token")!;
    expect(verifyStorageToken(downloadToken, "download").bucket).toBe("worker-files");
  });

  it("rejects path traversal and prevents public access to private buckets", async () => {
    const object = createLocalStorageClient().storage.from("confirmations");
    expect((await object.upload("../outside.pdf", Buffer.from("private"))).error).toBeTruthy();
    expect(() => object.getPublicUrl("secret.pdf")).toThrow();
    expect((await object.createSignedUploadUrl("a/../../outside.pdf")).error).toBeTruthy();
  });
});
