import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Landing Page Prerender & Dynamic Route Decoupling", () => {
  const landingPagePath = path.resolve(process.cwd(), "app/[locale]/page.tsx");
  const layoutPath = path.resolve(process.cwd(), "app/[locale]/layout.tsx");

  it("app/[locale]/page.tsx exists and is readable", () => {
    expect(fs.existsSync(landingPagePath)).toBe(true);
  });

  it("enforces export const dynamic = 'force-dynamic' on app/[locale]/page.tsx", () => {
    const content = fs.readFileSync(landingPagePath, "utf-8");
    // Must explicitly export dynamic = "force-dynamic"
    const dynamicRegex = /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/;
    expect(
      dynamicRegex.test(content),
      "app/[locale]/page.tsx must export const dynamic = 'force-dynamic' so database queries are deferred to request-time and not executed during static prerendering"
    ).toBe(true);
  });

  it("does not remove or stub dynamic database queries from LandingPage component", () => {
    const content = fs.readFileSync(landingPagePath, "utf-8");
    // Verify that prisma.systemSetting.findMany is preserved for runtime execution
    expect(
      content.includes("prisma.systemSetting.findMany"),
      "LandingPage must preserve real database queries for runtime request execution"
    ).toBe(true);
    // Verify that getCompanyConfig is preserved
    expect(
      content.includes("getCompanyConfig"),
      "LandingPage must preserve getCompanyConfig for runtime request execution"
    ).toBe(true);
  });

  it("preserves static parameter generation for locales on layout level", () => {
    const layoutContent = fs.readFileSync(layoutPath, "utf-8");
    expect(
      layoutContent.includes("generateStaticParams"),
      "app/[locale]/layout.tsx should preserve generateStaticParams for routing locales without forcing entire app static"
    ).toBe(true);
  });
});
