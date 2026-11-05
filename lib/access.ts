import "server-only";
import { randomInt, randomBytes } from "crypto";

// Passwordless "access link" login helpers (client/worker convenience; no PIN, at
// the companies' request). The admin generates a personal link and shares it; the
// user signs in once on a device and keeps a long-lived session there.
// The link is SINGLE-USE: loginWithToken consumes it, so a forwarded or leaked
// link is worthless after the first sign-in. Another device needs a new link.

// URL-safe, unguessable slug for the shared /access/<token> link (128 bits).
export function generateLoginToken(): string {
  // Use hex instead of base64url so double-clicking to copy selects the entire token
  return randomBytes(16).toString("hex");
}

// Only client & worker accounts use the passwordless link; admins keep email login.
export function roleUsesAccessLink(role: string): boolean {
  return role === "client" || role === "worker";
}
