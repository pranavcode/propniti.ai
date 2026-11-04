// Display names for agents and run statuses. A plain module (not "use client") so server pages,
// server code and client components all read the same names. Agents are named team members, so
// their names are Title Case; internal keys stay as they are.
export const AGENT_LABEL: Record<string, string> = {
  collections: "Collections Agent", leasing: "Leasing Agent", renewals: "Renewals Agent", maintenance_triage: "Maintenance Triage Agent", ap: "Payables Agent",
  data_health: "Data Health Agent", owner_reporting: "Owner Reporting Agent", compliance: "Compliance Agent", copilot: "Assistant",
};

const title = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

// "maintenance_triage" → "Maintenance Triage Agent". Unknown keys and names that already end in
// "agent" get the suffix once.
export function agentName(key: string | null | undefined): string {
  if (!key) return "Agent";
  if (AGENT_LABEL[key]) return AGENT_LABEL[key];
  const base = title(key.replace(/[_-]+/g, " ").replace(/\s+agent\s*$/i, "").trim());
  return base ? `${base} Agent` : "Agent";
}

export const RUN_STATUS_LABEL: Record<string, string> = { queued: "Queued", running: "Running", waiting_approval: "Waiting for approval", done: "Done", failed: "Failed" };
export const runStatusLabel = (s: string) => RUN_STATUS_LABEL[s] ?? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
