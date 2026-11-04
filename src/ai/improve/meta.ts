import { PERMISSIONS } from "@/auth/personas";
import type { ActionKey, AgentKey, ModuleKey, Role } from "@/entities/types";

// "Improve with AI" on a red KPI: which KPI metrics each improver serves, who may use it, when a
// value counts as red, and the shapes the panel renders. Client-safe: no server imports.

export const IMPROVERS = {
  delinquency: { title: "Past-due rent", module: "receivables", metrics: ["receivables.delinquency", "receivables.aging_live"] },
  vacancy: { title: "Occupancy", module: "leasing", metrics: ["portfolio.occupancy"] },
  sla: { title: "Maintenance SLA", module: "maintenance", metrics: ["maintenance.sla"] },
} as const satisfies Record<string, { title: string; module: ModuleKey; metrics: readonly string[] }>;
export type ImproveKey = keyof typeof IMPROVERS;

export const isImproveKey = (k: string): k is ImproveKey => Object.hasOwn(IMPROVERS, k);
export function improveKeyFor(metric: string): ImproveKey | null {
  for (const [k, v] of Object.entries(IMPROVERS)) if ((v.metrics as readonly string[]).includes(metric)) return k as ImproveKey;
  return null;
}

// Fixed alert lines on top of "moved the wrong way since last month". The panel states them.
export const THRESHOLDS = { occupancyBelow: 0.95, slaBelow: 0.9, over30OfRentRoll: 0.02 };

// Staff who can run agents and act on the metric's module (write or approve) may ask agents to
// work on it. Approving what the agents propose still follows the approvals rules.
export function canImprove(role: Role, key: ImproveKey, portal = false): boolean {
  if (portal) return false;
  const p = PERMISSIONS[role];
  const mod = p?.[IMPROVERS[key].module] ?? "none";
  return (p?.intelligence ?? "none") !== "none" && (mod === "write" || mod === "approve");
}

export function isRed(key: ImproveKey, k: { value: number | null; previous?: number | null; goodWhen?: "up" | "down" }): boolean {
  if (k.value == null) return false;
  if (k.previous != null && k.value !== k.previous && (k.value > k.previous) === ((k.goodWhen ?? "up") === "down")) return true;
  if (key === "vacancy") return k.value < THRESHOLDS.occupancyBelow;
  if (key === "sla") return k.value < THRESHOLDS.slaBelow;
  return false;
}

// An expected effect, always with the data it rests on. Observational history only ever earns
// Low or Medium confidence: there is no control group.
export type Estimate = { kind: "money" | "count"; value: number; text: string; basis: string; confidence: "Low" | "Medium"; sample: number };
export type Driver = { text: string; share: number | null; href?: string };
// Where the step's proposals go: Approvals, always a person (legal, safety), automatically within
// policy, some of each, or a step a person does (no agent action exists for it).
export type Routing = "approvals" | "always_person" | "auto" | "auto_some" | "person";
export type PlanStep = {
  key: string;
  title: string;
  detail: string;
  agent: AgentKey | null;
  agentName: string | null;
  action: ActionKey | null;
  actionLabel: string;
  ids: string[];
  records: number;
  eligible: number;
  waiting: number;            // records that already have this proposal open
  href?: string;
  risk: "Low" | "Medium" | "High";
  routing: Routing;
  estimate: Estimate | null;
  atStakeCents?: number;
};
export type PlanSummary = {
  id: string;
  since: string;
  plans: number;
  runs: { id: string; agent: string }[];
  records: number;
  proposals: { created: number; waiting: number; approved: number; auto: number; rejected: number };
  outcome: string[];
};
export type Preview = {
  key: ImproveKey;
  title: string;
  scope: string;
  property: string | null;
  asOf: string;
  headline: string;
  reasons: string[];
  drivers: Driver[];
  steps: PlanStep[];
  plan: PlanSummary | null;
};
export type ExecuteResult = { planId: string; created: number; waiting: number; auto: number; already: number; runs: { id: string; agent: string }[]; approvalsHref: string; runHref: string; message: string };
