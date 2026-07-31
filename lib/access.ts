import "server-only";
import { randomInt, randomBytes } from "crypto";

// Passwordless "access link + PIN" login helpers (client/worker convenience).
// The admin generates a link + PIN, shares them (ideally over two channels), and
// the user signs in on a device once; the persistent session then skips the PIN.
// The link token alone is NOT a credential — it must be paired with the PIN.

// and the user signs in on a device once; the persistent session skips logins.
// The link token is sufficient to access the platform.

// URL-safe, unguessable slug for the shared /access/<token> link (~192 bits).
export function generateLoginToken(): string {
  // Use hex instead of base64url so double-clicking to copy selects the entire token
  return randomBytes(16).toString("hex");
}

// Only client & worker accounts use the passwordless link; admins keep email login.
export function roleUsesAccessLink(role: string): boolean {
  return role === "client" || role === "worker";
}
