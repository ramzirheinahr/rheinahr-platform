import "server-only";
import path from "path";
import fs from "fs";
import { storagePath } from "@/lib/local-storage";

/**
 * Resolves a company logo into a valid react-pdf Image src (Buffer, local file path, or URL/data URI).
 * Handles:
 * 1. Data URIs and external HTTP/HTTPS URLs.
 * 2. Uploaded assets stored in local storage (/api/local-storage/...).
 * 3. Static assets in Next.js public directory.
 * 4. Fallback logos based on company shortName or default logo.
 */
export function resolvePdfLogo(logoUrl?: string | null, shortName?: string | null): Buffer | string | null {
  if (logoUrl) {
    // 1. Data URI or external URL
    if (logoUrl.startsWith("data:") || logoUrl.startsWith("http://") || logoUrl.startsWith("https://")) {
      return logoUrl;
    }

    // 2. Check local-storage upload paths (e.g. /api/local-storage/public/system-assets/...)
    if (logoUrl.includes("local-storage")) {
      try {
        const match = logoUrl.match(/(?:local-storage\/(?:public\/)?)(system-assets|confirmations|worker-files)\/(.+)/);
        if (match) {
          const bucket = match[1];
          const objPath = match[2];
          const absPath = storagePath(bucket, objPath);
          if (fs.existsSync(absPath)) {
            return fs.readFileSync(absPath);
          }
        }
      } catch {
        // Continue to fallback if storagePath resolution fails
      }
    }

    // 3. Check public directory
    const cleanPath = logoUrl.replace(/^\//, "");
    const publicPath = path.join(process.cwd(), "public", cleanPath);
    if (fs.existsSync(publicPath)) {
      return publicPath;
    }
  }

  // 4. Fallbacks by company branding
  if (shortName && shortName.toLowerCase().includes("rheinland")) {
    const rlBranding = path.join(process.cwd(), "public", "branding RheinLand.png");
    if (fs.existsSync(rlBranding)) return rlBranding;
    const rlLogo = path.join(process.cwd(), "public", "RheinLand Logo.png");
    if (fs.existsSync(rlLogo)) return rlLogo;
  }

  const defaultLogo = path.join(process.cwd(), "public", "logo.png");
  if (fs.existsSync(defaultLogo)) {
    return defaultLogo;
  }

  return null;
}
