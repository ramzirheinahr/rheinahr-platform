import type { MetadataRoute } from "next";

// Web App Manifest → served at /manifest.webmanifest. Makes the platform
// installable on phones (esp. the mobile-first care-staff portal).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RheinAhr Dienstleistungen",
    short_name: "RheinAhr",
    description: "Personaldienstleistung für die Altenpflege — Einsätze, Verfügbarkeit, Leistungsnachweise.",
    start_url: "/de",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1e3a8a",
    lang: "de",
    dir: "auto",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
