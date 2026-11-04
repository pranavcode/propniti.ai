import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    ignores: ["src/components/Link.tsx"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "next/link", message: "Import Link from @/components/Link: it prefetches on hover, not for every visible link." }] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    // vinext / Cloudflare build output
    "dist/**",
    ".cloudflare/**",
    ".vinext/**",
  ]),
]);

export default eslintConfig;
