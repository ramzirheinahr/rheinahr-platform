import type { MetadataRoute } from "next";
import { getCompanyConfig } from "@/lib/config/company";

// Web App Manifest → served at /manifest.webmanifest. Makes the platform
// installable on phones (esp. the mobile-first care-staff portal).
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const companyConfig = await getCompanyConfig();
  return {
    name: companyConfig.name,
    short_name: companyConfig.shortName,
    description: "Personaldienstleistung für die Altenpflege — Einsätze, Verfügbarkeit, Leistungsnachweise.",
    start_url: "/de",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1e3a8a",
    lang: "de",
    dir: "auto",
    icons: [
      { src: `/${companyConfig.shortName.toLowerCase()}-icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/${companyConfig.shortName.toLowerCase()}-icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/${companyConfig.shortName.toLowerCase()}-icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
