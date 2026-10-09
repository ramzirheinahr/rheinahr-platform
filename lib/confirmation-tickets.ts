import crypto from "node:crypto";

/**
 * Retrieves the cryptographic secret for confirmation tickets.
 * Explicitly rejects execution if neither CONFIRMATION_TICKET_SECRET nor NEXTAUTH_SECRET is configured.
 * Never falls back to a public or hardcoded key in production.
 */
export function getTicketSecret(): string {
  const secret = process.env.CONFIRMATION_TICKET_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || secret.trim().length < 16) {
    throw new Error(
      "CONFIRMATION_TICKET_SECRET oder NEXTAUTH_SECRET ist nicht oder unzureichend konfiguriert."
    );
  }
  return secret.trim();
}

export type TicketPayload = {
  ticketId: string;
  userId: string;
  requestGroupId: string;
  assignmentIds: string[]; // Strictly bound sorted list of assignment IDs
  path: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  issuedAt: number;
  expiresAt: number;
};

// In-memory fast cache to reject concurrent replay attempts within the local process instance
const consumedTicketIds = new Map<string, number>();

export function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

/**
 * Normalizes file extension/type mapping.
 */
export function normalizeMimeType(fileName: string, mimeType?: string): string {
  let type = mimeType?.toLowerCase().split(";")[0]?.trim();
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (!type || type === "application/octet-stream") {
    if (ext === "pdf") type = "application/pdf";
    else if (ext === "png") type = "image/png";
    else if (ext === "jpg" || ext === "jpeg") type = "image/jpeg";
    else if (ext === "webp") type = "image/webp";
  }
  if (type === "image/jpg") type = "image/jpeg";
  return type || "application/octet-stream";
}

/**
 * Inspects file buffer header (magic bytes) to strictly verify and identify real file types.
 * Rejects arbitrary text, HTML, spoofed extensions, or corrupted data.
 */
export function detectMimeTypeFromBuffer(buf: Uint8Array | Buffer): string | null {
  if (!buf || buf.length < 4) return null;

  // 1. PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (
    buf.length >= 5 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  ) {
    return "application/pdf";
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }

  // 3. JPEG: FF D8 FF
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "image/jpeg";
  }

  // 4. WebP: RIFF (bytes 0-3) and WEBP (bytes 8-11)
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

export function signTicket(payload: TicketPayload): string {
  const secret = getTicketSecret();
  // Ensure assignmentIds are canonically sorted in payload
  const canonicalPayload: TicketPayload = {
    ...payload,
    assignmentIds: Array.isArray(payload.assignmentIds)
      ? [...payload.assignmentIds].sort()
      : [],
  };
  const json = JSON.stringify(canonicalPayload);
  const base64 = Buffer.from(json).toString("base64url");
  const hmac = crypto.createHmac("sha256", secret).update(base64).digest("hex");
  return `${base64}.${hmac}`;
}

export function verifyTicket(ticketStr: string): TicketPayload | null {
  if (!ticketStr || typeof ticketStr !== "string") {
    return null;
  }
  let secret: string;
  try {
    secret = getTicketSecret();
  } catch {
    return null;
  }
  const parts = ticketStr.split(".");
  if (parts.length !== 2) return null;
  const [base64, expectedHmac] = parts;
  const computedHmac = crypto.createHmac("sha256", secret).update(base64).digest("hex");
  if (
    computedHmac.length !== expectedHmac.length ||
    !crypto.timingSafeEqual(Buffer.from(computedHmac), Buffer.from(expectedHmac))
  ) {
    return null;
  }
  try {
    const payload: TicketPayload = JSON.parse(Buffer.from(base64, "base64url").toString("utf-8"));
    if (!payload || typeof payload !== "object" || !payload.ticketId) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function isTicketExpired(payload: TicketPayload, now = Date.now()): boolean {
  return now > payload.expiresAt;
}

export function markTicketLocallyConsumed(ticketId: string, expiresAt: number) {
  consumedTicketIds.set(ticketId, expiresAt);
  // Auto-prune expired tickets periodically
  const now = Date.now();
  if (consumedTicketIds.size > 1000) {
    for (const [id, exp] of consumedTicketIds.entries()) {
      if (now > exp) {
        consumedTicketIds.delete(id);
      }
    }
  }
}

export function isTicketLocallyConsumed(ticketId: string): boolean {
  const exp = consumedTicketIds.get(ticketId);
  if (!exp) return false;
  if (Date.now() > exp) {
    consumedTicketIds.delete(ticketId);
    return false;
  }
  return true;
}
