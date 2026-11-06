// The visitor's real IP for audit logs, signatures (Leistungsnachweis, contracts)
// and rate limiting.
//
// Production traffic arrives through the Cloudflare tunnel, and Cloudflare sets
// CF-Connecting-IP itself (a client-supplied value is overwritten), so it is the
// trustworthy source. X-Forwarded-For / X-Real-IP are only a fallback for local
// development: their first entry is whatever the client chose to send.
export function clientIp(headers: Pick<Headers, "get">): string | null {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get("x-real-ip")?.trim() || null;
}
