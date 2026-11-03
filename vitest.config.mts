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
    // v2: these run against the 0001 tables that 0002_v2.sql drops. Lane A (Data) ports them to
    // the new schema and deletes this line.
    exclude: ["src/server/server.test.ts", "src/server/routes.test.ts", "**/node_modules/**"],
    coverage: { provider: "v8", include: ["src/lib/**", "src/server/**", "src/app/api/**"], reporter: ["text", "html"] },
  },
});
