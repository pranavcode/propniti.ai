import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  resolve: {
    // On Workers, use the platform module that reads Cloudflare bindings.
    alias: [{ find: /^@\/lib\/platform$/, replacement: fileURLToPath(new URL("./src/lib/platform/workers.ts", import.meta.url)) }],
  },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
