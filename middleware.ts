import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Locale negotiation + prefixing. Runs in the Next.js 16 "proxy" convention
// (renamed from middleware.ts). Role/auth guards are enforced per-route & in
// the (admin|client|worker) layouts (server-side) — never trust the client.
export default createMiddleware(routing);

export const config = {
  // Match all pathnames except API, Next internals, and static files.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
