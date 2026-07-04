import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow server actions / route handlers to use the Node bcrypt + Prisma deps.
  // (Renamed from experimental.serverComponentsExternalPackages in Next.js 15.)
  serverExternalPackages: [
    "@prisma/client",
    "bcryptjs",
    "@react-pdf/renderer",
  ],
};

export default withNextIntl(nextConfig);
