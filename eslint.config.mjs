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
    // Vercel build output (deploy artifacts, not source):
    ".vercel/**",
    // Static assets shipped verbatim (self-hosted MediaPipe wasm glue is
    // minified Emscripten output, not lintable source):
    "public/**",
  ]),
]);

export default eslintConfig;
