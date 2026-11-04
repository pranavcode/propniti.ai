import { describe, expect, it } from "vitest";
import { getAgent } from "../agents/registry";
import { loadAgents } from "../orchestrator";
import { AGENT_LABEL, agentName, runStatusLabel } from "../ui/labels";

// Agents are named team members: one Title Case name per agent, everywhere, with "Agent" once.
describe("agent names", () => {
  it("names the eight agents in Title Case", () => {
    expect(["collections", "leasing", "renewals", "maintenance_triage", "ap", "data_health", "owner_reporting", "compliance"].map(agentName)).toEqual([
      "Collections Agent", "Leasing Agent", "Renewals Agent", "Maintenance Triage Agent", "Payables Agent", "Data Health Agent", "Owner Reporting Agent", "Compliance Agent",
    ]);
  });

  it("matches the agent registry's display names", async () => {
    await loadAgents();
    for (const key of Object.keys(AGENT_LABEL).filter((k) => k !== "copilot")) expect(getAgent(key as never)?.name, key).toBe(agentName(key));
  });

  it("adds Agent once to unknown keys and names that already say agent", () => {
    expect(agentName("payables")).toBe("Payables Agent");
    expect(agentName("rent_review")).toBe("Rent Review Agent");
    expect(agentName("compliance agent")).toBe("Compliance Agent");
    expect(agentName("lease_audit_agent")).toBe("Lease Audit Agent");
    expect(agentName(null)).toBe("Agent");
  });

  it("labels run statuses in words", () => {
    expect(runStatusLabel("waiting_approval")).toBe("Waiting for approval");
    expect(runStatusLabel("done")).toBe("Done");
    expect(runStatusLabel("paused_by_owner")).toBe("Paused by owner");
  });
});
