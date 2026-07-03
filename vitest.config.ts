import { defineConfig } from "vitest/config";
import path from "node:path";

// Resolve the same "@/…" path alias the app uses (tsconfig paths) so unit
// tests can import modules that reference it (e.g. lib/pricing.ts).
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
