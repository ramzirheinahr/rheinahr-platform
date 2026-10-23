/**
 * Safely constructs an absolute URL for redirects in reverse-proxied environments (e.g. Cloudflare tunnel),
 * ensuring the browser is never redirected to internal origin hostnames like 'localhost:3000'.
 */
export function getSafeRedirectUrl(targetPathOrUrl: string, req: Request): URL {
  if (/^https?:\/\//i.test(targetPathOrUrl)) {
    const parsed = new URL(targetPathOrUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
      const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
      const base = process.env.NEXT_PUBLIC_APP_URL || (forwardedHost && !forwardedHost.includes("localhost") ? `${forwardedProto}://${forwardedHost}` : null);
      if (base) {
        return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, base);
      }
    }
    return parsed;
  }

  const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || (forwardedHost?.includes("localhost") ? "http" : "https");

  if (process.env.NEXT_PUBLIC_APP_URL && (!forwardedHost || forwardedHost.includes("localhost"))) {
    return new URL(targetPathOrUrl, process.env.NEXT_PUBLIC_APP_URL);
  }

  if (forwardedHost && !forwardedHost.includes("localhost")) {
    return new URL(targetPathOrUrl, `${forwardedProto}://${forwardedHost}`);
  }

  if (process.env.NEXT_PUBLIC_APP_URL) {
    return new URL(targetPathOrUrl, process.env.NEXT_PUBLIC_APP_URL);
  }

  return new URL(targetPathOrUrl, req.url);
}
