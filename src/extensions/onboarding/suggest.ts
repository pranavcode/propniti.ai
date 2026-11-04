// Approval limits and agent autonomy sized to the portfolio. Figures are dollars, computed here
// from the workspace's records; the basis sentence quotes the same figures so a person can check
// them. The model plays no part in these numbers.

export type Stats = {
  units: number; unitsFrom: "import" | "stated" | "workspace";
  workOrders: number[]; bills: number[]; // completed vendor work order costs, bill totals
  rents: number[]; rentsFrom: "import" | "workspace"; // monthly rent of active leases
  // Full record counts when the arrays are an even sample of a larger table (sorted, every k-th).
  counts?: { workOrders: number; bills: number; rents: number };
};
export type PolicyNow = { id: string; category: string; limit: number | null; owner: number | null; approver: string; alwaysHuman: boolean };
export type Confidence = "High" | "Medium" | "Low";
export type PolicySuggestion = {
  id: string; category: string;
  current: { limit: number | null; owner: number | null };
  suggested: { limit: number | null; owner: number | null };
  basis: string; sample: number; confidence: Confidence; changed: boolean;
};
export type AgentNow = { key: string; name: string; autonomy: string };
export type Autonomy = "act_with_approval" | "auto_within_policy";
export type AutonomySuggestion = { key: string; name: string; current: Autonomy; suggested: Autonomy; basis: string; changed: boolean };

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// Linear interpolation between the closest ranks.
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  return Math.round((s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (pos - lo)) * 100) / 100;
}

const step = (x: number) => (x < 100 ? 25 : x < 1000 ? 100 : x < 10_000 ? 500 : 1000);
export const niceCeil = (x: number) => Math.ceil(x / step(x)) * step(x);
export const niceFloor = (x: number) => Math.max(step(x), Math.floor(x / step(x)) * step(x));

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const confidence = (n: number): Confidence => (n >= 30 ? "High" : n >= 5 ? "Medium" : "Low");
const MIN_SAMPLE = 5;

export function suggestPolicies(stats: Stats, policies: PolicyNow[]): PolicySuggestion[] {
  const out: PolicySuggestion[] = [];
  const n = { workOrders: stats.counts?.workOrders ?? stats.workOrders.length, bills: stats.counts?.bills ?? stats.bills.length, rents: stats.counts?.rents ?? stats.rents.length };
  const rentsWhere = stats.rentsFrom === "import" ? count(n.rents, "imported lease") : count(n.rents, "lease") + " in this workspace";
  for (const p of policies) {
    if (p.alwaysHuman || p.category === "Owner distribution") continue;
    const current = { limit: p.limit, owner: p.owner };
    const keep = (basis: string, sample: number): PolicySuggestion => ({ id: p.id, category: p.category, current, suggested: current, basis, sample, confidence: "Low", changed: false });
    let s: PolicySuggestion | null = null;
    if (p.category === "Maintenance spend" || p.category === "Bill payment") {
      const maint = p.category === "Maintenance spend";
      const xs = maint ? stats.workOrders : stats.bills;
      const total = maint ? n.workOrders : n.bills;
      const what = maint ? ["completed vendor work order", "job", "jobs"] : ["bill", "bill", "bills"];
      if (xs.length < MIN_SAMPLE) { out.push(keep(`Only ${count(total, what[0]!)} on file, too few to size a limit. Kept as it is.`, total)); continue; }
      const mid = median(xs)!;
      const pct = maint ? 0.9 : 0.95;
      const high = percentile(xs, pct)!;
      const limit = niceCeil(mid);
      const owner = Math.max(niceCeil(high), limit);
      s = {
        id: p.id, category: p.category, current, suggested: { limit, owner }, sample: total, confidence: confidence(total), changed: false,
        basis: `Median ${what[0]} ${usd(mid)} across ${count(total, what[1]!, what[2])} → auto-approve up to ${usd(limit)}. ${pct * 100}th percentile ${usd(high)} → owner approves above ${usd(owner)}.`,
      };
    } else if (p.category === "Concession" || p.category === "Write-off") {
      if (stats.rents.length < MIN_SAMPLE) { out.push(keep(`Only ${rentsWhere}, too few to size a limit. Kept as it is.`, n.rents)); continue; }
      const mid = median(stats.rents)!;
      const limit = niceFloor(mid * (p.category === "Concession" ? 0.25 : 0.05));
      s = {
        id: p.id, category: p.category, current, suggested: { limit, owner: p.owner }, sample: n.rents, confidence: confidence(n.rents), changed: false,
        basis: p.category === "Concession"
          ? `Median rent ${usd(mid)} on ${rentsWhere} → concessions up to ${usd(limit)} (a quarter of a month's rent, rounded down) without a manager.`
          : `5% of the median rent (${usd(mid)} on ${rentsWhere}) → write off balances up to ${usd(limit)} without a manager.`,
      };
    }
    if (s) out.push({ ...s, changed: s.suggested.limit !== current.limit || s.suggested.owner !== current.owner });
  }
  return out;
}

// Routine agents (formatting fixes, compliance reminders, dispatch under the maintenance limit) may
// act within policy once a portfolio is big enough that reviewing each one costs real time. Agents
// that move money stay approve-first, except bill payment under its limit at 1,000+ units.
const ROUTINE = new Set(["data_health", "compliance", "maintenance_triage"]);

export function suggestAutonomy(units: number, from: Stats["unitsFrom"], agents: AgentNow[]): AutonomySuggestion[] {
  const size = `${count(units, from === "import" ? "imported unit" : "unit")}${from === "stated" ? " (your estimate)" : from === "workspace" ? " in this workspace" : ""}`;
  return agents.map((a) => {
    const current: Autonomy = a.autonomy === "auto_within_policy" ? "auto_within_policy" : "act_with_approval";
    let suggested: Autonomy = "act_with_approval";
    let basis: string;
    if (units < 100) basis = `${size}: few enough to see every proposal before it runs.`;
    else if (ROUTINE.has(a.key)) { suggested = "auto_within_policy"; basis = `${size}: routine work under your limits runs on its own and is logged; money over a limit, legal and safety still wait for a person.`; }
    else if (a.key === "ap" && units >= 1000) { suggested = "auto_within_policy"; basis = `${size}: bills under the bill-payment limit are paid on their own; larger bills wait for a person.`; }
    else basis = `${size}: this agent moves money or changes leases, so a person approves each proposal at first.`;
    return { key: a.key, name: a.name, current, suggested, basis, changed: suggested !== current };
  });
}
