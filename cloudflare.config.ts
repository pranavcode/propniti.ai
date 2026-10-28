import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "property-mgmt-ai-prototype",
    entrypoint: "vinext/server/fetch-handler",
    domains: ["propniti.ai", "www.propniti.ai"],
    workersDev: true,
    compatibilityDate: "2026-10-28",
    compatibilityFlags: ["nodejs_compat", "nodejs_compat_populate_process_env"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      // Workers AI: default model provider when no Anthropic/OpenAI key is set.
      AI: bindings.ai({ dev: { remote: true } }),
      // Per-IP cap on the paid AI routes.
      AI_RATE_LIMITER: bindings.rateLimit({ namespace: "1001", simple: { limit: 20, period: 60 } }),
      // Optional AI settings; unset = mock data. Set with `npx wrangler secret put <NAME>`.
      ANTHROPIC_API_KEY: bindings.secret(),
      OPENAI_API_KEY: bindings.secret(),
      AI_PROVIDER: bindings.secret(),
    },
  }),
});
