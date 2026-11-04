// Agent names as people read them. A plain module (not "use client") so server pages can read it.
export const AGENT_LABEL: Record<string, string> = {
  collections: "Collections agent", leasing: "Leasing agent", renewals: "Renewals agent", maintenance_triage: "Maintenance triage agent", ap: "Payables agent",
  data_health: "Data Health agent", owner_reporting: "Owner Reporting agent", compliance: "Compliance agent", copilot: "Assistant",
};
