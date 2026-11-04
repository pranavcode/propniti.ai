import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't load the Cloudflare/vinext plugins.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "evals/**/*.test.mjs"],
    exclude: ["**/node_modules/**"],
    coverage: { provider: "v8", include: ["src/lib/**", "src/server/**", "src/app/api/**"], reporter: ["text", "html"] },
  },
});
