import type { Row } from "@/entities/types";
import { demoNow } from "@/lib/clock";
import { parseJson, sql, type DataCtx } from "../data";
import { defineAgent, money, planOf, type Candidate } from "./framework";
import { triage } from "../rules";
import { coiVerifiedSql } from "@/extensions/risk/sql";
export { triage } from "../rules";

// Triage of new work orders: trade, urgency, a cost estimate from history, ranked vendors and the
// owner approval limit. Safety issues (gas, smoke, sparks, flooding) always go to a person.
// "Improve with AI" plans also send it past-SLA jobs whose vendor is overloaded, to propose a
// vendor with capacity (a person approves the switch).

export type PoolVendor = Row & { id: string; company: string; open_jobs: number; coi_expires: string | null };

// Active vendors with their open jobs and latest verified insurance. One query at a time and no
// per-vendor subqueries: D1 shares capacity with every visitor.
export async function vendorPool(data: DataCtx): Promise<PoolVendor[]> {
  const active = await sql<Row>(data, "SELECT v.id, v.company, v.trade, v.metros, v.rating, v.status FROM {vendors} v WHERE v.status = 'Active'", [], { unscoped: true });
  const jobs = new Map((await sql<{ vendor_id: string; n: number }>(data, "SELECT vendor_id, count(*) AS n FROM {work_orders} WHERE vendor_id IS NOT NULL AND status IN ('Assigned', 'Scheduled', 'In progress') GROUP BY vendor_id", [], { unscoped: true })).map((r) => [r.vendor_id, r.n]));
  const cois = new Map((await sql<{ vendor_id: string; e: string }>(data, `SELECT k.vendor_id, max(k.expires_on) AS e FROM {vendor_cois} k WHERE ${coiVerifiedSql("k")} GROUP BY k.vendor_id`, [], { unscoped: true })).map((r) => [r.vendor_id, r.e]));
  return active.map((v) => ({ ...v, id: String(v.id), company: String(v.company), open_jobs: jobs.get(String(v.id)) ?? 0, coi_expires: cois.get(String(v.id)) ?? null }));
}

// Vendors for a trade in a metro with valid insurance, best first (rating, minus load).
export function rankVendors(vendors: PoolVendor[], trade: string, metro: string, today: string) {
  return vendors
    .filter((v) => v.trade === trade && parseJson<string[]>(v.metros, []).includes(metro) && v.coi_expires && String(v.coi_expires) >= today)
    .map((v) => ({ v, score: Number(v.rating ?? 3) * 20 - v.open_jobs * 5 }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.v);
}

// A job already with a vendor is worth moving only to a ranked vendor with fewer open jobs.
export function reassignTarget(w: { vendor_id?: unknown; category?: unknown }, vendors: PoolVendor[], metro: string, today: string): { from: PoolVendor | null; to: PoolVendor } | null {
  const from = vendors.find((v) => v.id === w.vendor_id) ?? null;
  const to = rankVendors(vendors, String(w.category), metro, today).find((v) => v.id !== w.vendor_id);
  if (!to || (from && to.open_jobs >= from.open_jobs)) return null;
  return { from, to };
}

export default defineAgent({
  key: "maintenance_triage",
  name: "Maintenance Triage Agent",
  ownerRole: "maintenance_supervisor",
  goal: "Triage every new work order: trade, urgency, a cost estimate from past jobs, the best available vendor, and whether the owner's approval limit is exceeded.",
  tools: ["records.search", "records.get", "records.related", "policy.lookup", "actions.propose"],
  triggers: { schedule: "*/15 * * * *", events: ["wo.created", "service_request.created"] },
  autonomy: "auto_within_policy",
  entities: ["work_orders", "vendors"],
  actions: ["work_orders.triage", "work_orders.assign_vendor"],
  maxProposals: 10,
  async collect(ctx, trigger) {
    const one = (trigger.input as { work_order_id?: string } | undefined)?.work_order_id;
    const plan = planOf(trigger);
    const filters = plan ? [{ field: "id", op: "in", value: plan.ids.slice(0, 50) }] : one ? [{ field: "id", op: "eq", value: one }] : [{ field: "status", op: "eq", value: "New" }];
    const wos = await ctx.call<{ rows: Row[] }>("records.search", { entity: "work_orders", filters, sort: ["opened_at", "asc"], size: plan ? 50 : 15 });
    if (!wos.rows.length) return [];
    const policies = await ctx.call<{ approval_policies: Row[] }>("policy.lookup", { category: "Maintenance spend" });
    const pol = policies.approval_policies.find((p) => p.owner_entity_id == null) ?? policies.approval_policies[0];
    const limit = pol?.limit_cents == null ? null : Number(pol.limit_cents);
    const ownerOver = pol?.owner_approval_over_cents == null ? null : Number(pol.owner_approval_over_cents);
    const costs = await sql<{ category: string; cost: number }>(ctx.data, "SELECT category, cost_cents AS cost FROM {work_orders} WHERE cost_cents > 0 AND status IN ('Completed', 'Paid') ORDER BY category, cost_cents LIMIT 5000", [], { unscoped: true });
    const vendors = await vendorPool(ctx.data);
    const props = await sql<{ id: string; metro: string; name: string }>(ctx.data, "SELECT id, metro, name FROM {properties}");
    const median = (cat: string) => {
      const xs = costs.filter((c) => c.category === cat).map((c) => c.cost);
      return xs.length ? xs[Math.floor(xs.length / 2)] : null;
    };
    const month = Number(ctx.today.slice(5, 7));
    return wos.rows.flatMap((w): Candidate[] => {
      const prop = props.find((p) => p.id === w.property_id);
      // Plans: only New jobs are triaged. A job a person already triaged keeps its priority and trade
      // and only gets a vendor proposal; a job with a vendor moves only to one with capacity.
      if (plan && w.status !== "New") {
        const r = ["Triaged", "Assigned", "Scheduled"].includes(String(w.status)) ? reassignTarget(w, vendors, prop?.metro ?? "", ctx.today) : null;
        if (!r) return [];
        const late = w.sla_due_at ? Math.max(0, Math.round((demoNow(ctx.nowMs).getTime() - Date.parse(String(w.sla_due_at))) / 3_600_000)) : null;
        return [{
          entity: "work_orders", entityId: String(w.id), propertyId: String(w.property_id), action: "work_orders.assign_vendor",
          title: `${w.id}: ${r.from ? "move" : "assign"} to ${r.to.company} (${r.to.open_jobs} open jobs${r.from ? ` vs ${r.from.open_jobs} with ${r.from.company}` : ""})`,
          why: [
            late != null ? `Past its SLA due time by about ${late} hours (${String(w.priority).toLowerCase()} priority)` : "Open past its SLA due time",
            r.from ? `${r.from.company} has ${r.from.open_jobs} open jobs` : `Triaged as ${String(w.category).toLowerCase()}, ${String(w.priority).toLowerCase()} priority, with no vendor yet`,
            `${r.to.company}: rating ${r.to.rating ?? "n/a"}, ${r.to.open_jobs} open jobs, insurance valid to ${r.to.coi_expires}`,
          ],
          confidence: 0.75, risk: "Medium",
          facts: { work_order: String(w.id), title: String(w.title), from_vendor: r.from?.company ?? null, to_vendor: r.to.company, to_open_jobs: r.to.open_jobs, property: prop?.name ?? null },
          evidence: [{ entity_type: "work_orders", entity_id: String(w.id), label: String(w.title) }, { entity_type: "vendors", entity_id: r.to.id, label: r.to.company }],
          effects: [{ kind: "update", table: "work_orders", id: String(w.id), changes: { vendor_id: r.to.id, status: "Assigned" } }],
          priority: 1500 + (late ?? 0),
        }];
      }
      const t = triage(`${w.title} ${w.description ?? ""}`, month);
      const best = rankVendors(vendors, t.trade, prop?.metro ?? "", ctx.today)[0];
      const estimate = median(t.trade) ?? median(String(w.category)) ?? 25000;
      const overOwner = ownerOver != null && estimate > ownerOver;
      const why = [
        `Reads as ${t.trade}, ${t.priority.toLowerCase()}${t.safety ? " (safety issue)" : ""}`,
        `Typical ${t.trade.toLowerCase()} job costs ${money(estimate)} (median of past jobs)`,
        best ? `${best.company}: rating ${best.rating ?? "n/a"}, ${best.open_jobs} open jobs, insurance valid to ${best.coi_expires}` : `No ${t.trade.toLowerCase()} vendor with valid insurance covers ${prop?.metro ?? "this metro"}; assign in-house`,
        overOwner ? `Over the owner's ${money(ownerOver!)} approval limit: the owner approves in their portal` : limit != null ? `Within the ${money(limit)} auto-approve limit` : "No auto-approve limit set",
      ];
      return [{
        entity: "work_orders", entityId: String(w.id), propertyId: String(w.property_id), action: "work_orders.triage",
        title: `${w.id}: ${t.trade}, ${t.priority}${best ? ` → ${best.company}` : ""} (est. ${money(estimate)})`,
        why, confidence: best ? 0.88 : 0.7, risk: t.safety ? "High" : "Low", category: t.safety ? "Safety" : "Maintenance spend", amountCents: estimate, alwaysHuman: t.safety, mandatory: t.safety,
        facts: { work_order: String(w.id), title: String(w.title), trade: t.trade, priority: t.priority, estimate_cents: estimate, vendor: best ? String(best.company) : null, property: prop?.name ?? null },
        evidence: [{ entity_type: "work_orders", entity_id: String(w.id), label: String(w.title) }, ...(best ? [{ entity_type: "vendors", entity_id: String(best.id), label: String(best.company) }] : [])],
        effects: [{ kind: "update", table: "work_orders", id: String(w.id), changes: { category: t.trade, priority: t.priority, vendor_id: best ? String(best.id) : null, status: best ? "Assigned" : "Triaged", estimate_cents: estimate } }],
        priority: (t.safety ? 3000 : t.priority === "Urgent" ? 2000 : 1000) + (best ? 10 : 0),
      }];
    });
  },
});
