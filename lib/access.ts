import "server-only";
import { randomInt, randomBytes } from "crypto";

// Passwordless "access link + PIN" login helpers (client/worker convenience).
// The admin generates a link + PIN, shares them (ideally over two channels), and
// the user signs in on a device once; the persistent session then skips the PIN.
// The link token alone is NOT a credential — it must be paired with the PIN.

// Brute-force policy for the 6-digit PIN.
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 15;

// URL-safe, unguessable slug for the shared /access/<token> link (~192 bits).
export function generateLoginToken(): string {
  return randomBytes(24).toString("base64url");
}

// Cryptographically-uniform 6-digit PIN (leading zeros allowed).
export function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// Only client & worker accounts use the passwordless link; admins keep email login.
export function roleUsesAccessLink(role: string): boolean {
  return role === "client" || role === "worker";
}
