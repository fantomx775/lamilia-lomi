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
    // Private task scratch/evidence, never application source.
    ".task/**",
    // Vendor files copied by scripts/prepare-admin-video-encoder.mjs.
    "public/admin-video-encoder/**",
  ]),
]);

export default eslintConfig;
