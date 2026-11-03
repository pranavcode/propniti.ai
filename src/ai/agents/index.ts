// Loads every agent so the registry is complete (and the tools they call).
import "../tools";
import "./collections";
import "./leasing";
import "./renewals";
import "./maintenance";
import "./payables";
import "./data-health";
import "./owner-reporting";
import "./compliance";
export * from "./registry";

// Display order on the command center.
export const AGENT_ORDER = ["collections", "leasing", "renewals", "maintenance_triage", "ap", "data_health", "owner_reporting", "compliance"] as const;
