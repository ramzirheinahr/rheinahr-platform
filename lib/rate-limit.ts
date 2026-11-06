// Fixed-window attempt counter for brute-force protection (login, access links,
// password-reset requests).
//
// In memory on purpose: each company runs as a single Node process (pm2 fork
// mode), so one Map sees every request. A restart clears the counters, which only
// ever errs toward letting a legitimate user back in.
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
const MAX_KEYS = 50_000;

function current(key: string, now: number): Window | undefined {
  const w = windows.get(key);
  if (w && w.resetAt <= now) {
    windows.delete(key);
    return undefined;
  }
  return w;
}

function sweep(now: number) {
  if (windows.size < MAX_KEYS) return;
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
}

// True while `key` has used up `limit` attempts in the current window.
export function isRateLimited(key: string, limit: number, now = Date.now()): boolean {
  return (current(key, now)?.count ?? 0) >= limit;
}

// Counts one attempt against `key`; the window starts at the first attempt.
export function recordAttempt(key: string, windowMs: number, now = Date.now()): void {
  sweep(now);
  const w = current(key, now);
  if (w) w.count++;
  else windows.set(key, { count: 1, resetAt: now + windowMs });
}

export function clearAttempts(key: string): void {
  windows.delete(key);
}

export const LIMITS = {
  // Failed password logins per account email, and per IP (an office NAT may
  // carry several users, hence the higher IP budget).
  loginPerEmail: { limit: 5, windowMs: 15 * 60_000 },
  loginPerIp: { limit: 30, windowMs: 15 * 60_000 },
  // Invalid / spent access-link attempts per IP.
  accessLinkPerIp: { limit: 20, windowMs: 15 * 60_000 },
  // Password-reset emails per address and per IP (stops mail bombing).
  resetPerEmail: { limit: 3, windowMs: 60 * 60_000 },
  resetPerIp: { limit: 10, windowMs: 60 * 60_000 },
} as const;
