"use client";

import { useEffect } from "react";

// Registers the service worker (production only) so the app is installable
// and has a basic offline fallback.
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* registration failure is non-fatal */
    });
  }, []);
  return null;
}
