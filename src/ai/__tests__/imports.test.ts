import { describe, expect, it } from "vitest";

// Import order matters on Workers: an extension that statically imports an agent module while the
// agent framework is still loading crashed every page ("wl is not a function"). Loading the entity
// registry on its own must work, and must not pull agent modules in.
describe("module graph", () => {
  it("loads @/entities alone, with no agent registered as a side effect", async () => {
    const entities = await import("@/entities");
    expect(entities.allEntities().length).toBeGreaterThan(10);
    const { allAgents } = await import("@/ai/agents/registry");
    expect(allAgents()).toHaveLength(0);
  });

  it("registers the eight agents when the orchestrator first needs them", async () => {
    const { loadAgents } = await import("@/ai/orchestrator");
    await loadAgents();
    const { allAgents } = await import("@/ai/agents/registry");
    expect(allAgents().map((a) => a.key).sort()).toEqual(["ap", "collections", "compliance", "data_health", "leasing", "maintenance_triage", "owner_reporting", "renewals"]);
  });

  it("keeps the shared rules free of runtime imports", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/ai/rules.ts", "utf8");
    expect(src.split("\n").filter((l) => l.startsWith("import ") && !l.startsWith("import type"))).toEqual([]);
  });
});
