import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// ESLint flat config (required by ESLint 10 / Next.js 16 — replaces .eslintrc.json).
// `next lint` was removed in Next.js 16; lint runs via the ESLint CLI (`eslint .`).
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
