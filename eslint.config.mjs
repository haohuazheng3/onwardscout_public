import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Ours:
    "public-out/**",
    "public-repo/**",
    // Cloudflare workers have their own tsconfig and are deployed with wrangler, not Next.
    "infra/workers/**",
    "public/**",
    "docs/**",
    "drizzle/**",
    ".vercel/**",
  ]),
]);

export default eslintConfig;
