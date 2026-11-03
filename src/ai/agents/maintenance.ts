import type { Row } from "@/entities/types";
import { parseJson, sql } from "../data";
import { defineAgent, money, type Candidate } from "./framework";
import { triage } from "../rules";
import { verifiedCoiExpirySql } from "@/extensions/risk/sql";
export { triage } from "../rules";

// Triage of new work orders: trade, urgency, a cost estimate from history, ranked vendors and the
// owner approval limit. Safety issues (gas, smoke, sparks, flooding) always go to a person.

export default defineAgent({
  key: "maintenance_triage",
  name: "Maintenance triage agent",
  ownerRole: "maintenance_supervisor",
  goal: "Triage every new work order: trade, urgency, a cost estimate from past jobs, the best available vendor, and whether the owner's approval limit is exceeded.",
  tools: ["records.search", "records.get", "records.related", "policy.lookup", "actions.propose"],
  triggers: { schedule: "*/15 * * * *", events: ["wo.created", "service_request.created"] },
  autonomy: "auto_within_policy",
  entities: ["work_orders", "vendors"],
  actions: ["work_orders.triage"],
  maxProposals: 10,
  async collect(ctx, trigger) {
    const one = (trigger.input as { work_order_id?: string } | undefined)?.work_order_id;
    const wos = await ctx.call<{ rows: Row[] }>("records.search", { entity: "work_orders", filters: one ? [{ field: "id", op: "eq", value: one }] : [{ field: "status", op: "eq", value: "New" }], sort: ["opened_at", "asc"], size: 15 });
    if (!wos.rows.length) return [];
    const policies = await ctx.call<{ approval_policies: Row[] }>("policy.lookup", { category: "Maintenance spend" });
    const pol = policies.approval_policies.find((p) => p.owner_entity_id == null) ?? policies.approval_policies[0];
    const limit = pol?.limit_cents == null ? null : Number(pol.limit_cents);
    const ownerOver = pol?.owner_approval_over_cents == null ? null : Number(pol.owner_approval_over_cents);
    const [costs, vendors, props] = await Promise.all([
      sql<{ category: string; cost: number }>(ctx.data, "SELECT category, cost_cents AS cost FROM {work_orders} WHERE cost_cents > 0 AND status IN ('Completed', 'Paid') ORDER BY category, cost_cents", [], { unscoped: true }),
      sql<Row>(ctx.data,
        `SELECT v.id, v.company, v.trade, v.metros, v.rating, v.status, (SELECT count(*) FROM {work_orders} w WHERE w.vendor_id = v.id AND w.status IN ('Assigned', 'Scheduled', 'In progress')) AS open_jobs,
                ${verifiedCoiExpirySql("{vendor_cois}", "v.id")} AS coi_expires
         FROM {vendors} v WHERE v.status = 'Active'`, [], { unscoped: true }),
      sql<{ id: string; metro: string; name: string }>(ctx.data, "SELECT id, metro, name FROM {properties}"),
    ]);
    const median = (cat: string) => {
      const xs = costs.filter((c) => c.category === cat).map((c) => c.cost);
      return xs.length ? xs[Math.floor(xs.length / 2)] : null;
    };
    const month = Number(ctx.today.slice(5, 7));
    return wos.rows.map((w): Candidate => {
      const t = triage(`${w.title} ${w.description ?? ""}`, month);
      const prop = props.find((p) => p.id === w.property_id);
      const ranked = vendors
        .filter((v) => v.trade === t.trade && parseJson<string[]>(v.metros, []).includes(prop?.metro ?? "") && v.coi_expires && String(v.coi_expires) >= ctx.today)
        .map((v) => ({ v, score: Number(v.rating ?? 3) * 20 - Number(v.open_jobs) * 5 }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0]?.v;
      const estimate = median(t.trade) ?? median(String(w.category)) ?? 25000;
      const overOwner = ownerOver != null && estimate > ownerOver;
      const why = [
        `Reads as ${t.trade}, ${t.priority.toLowerCase()}${t.safety ? " (safety issue)" : ""}`,
        `Typical ${t.trade.toLowerCase()} job costs ${money(estimate)} (median of past jobs)`,
        best ? `${best.company}: rating ${best.rating ?? "n/a"}, ${best.open_jobs} open jobs, insurance valid to ${best.coi_expires}` : `No ${t.trade.toLowerCase()} vendor with valid insurance covers ${prop?.metro ?? "this metro"}; assign in-house`,
        overOwner ? `Over the owner's ${money(ownerOver!)} approval limit: the owner approves in their portal` : limit != null ? `Within the ${money(limit)} auto-approve limit` : "No auto-approve limit set",
      ];
      return {
        entity: "work_orders", entityId: String(w.id), propertyId: String(w.property_id), action: "work_orders.triage",
        title: `${w.id}: ${t.trade}, ${t.priority}${best ? ` → ${best.company}` : ""} (est. ${money(estimate)})`,
        why, confidence: best ? 0.88 : 0.7, risk: t.safety ? "High" : "Low", category: t.safety ? "Safety" : "Maintenance spend", amountCents: estimate, alwaysHuman: t.safety, mandatory: t.safety,
        facts: { work_order: String(w.id), title: String(w.title), trade: t.trade, priority: t.priority, estimate_cents: estimate, vendor: best ? String(best.company) : null, property: prop?.name ?? null },
        evidence: [{ entity_type: "work_orders", entity_id: String(w.id), label: String(w.title) }, ...(best ? [{ entity_type: "vendors", entity_id: String(best.id), label: String(best.company) }] : [])],
        effects: [{ kind: "update", table: "work_orders", id: String(w.id), changes: { category: t.trade, priority: t.priority, vendor_id: best ? String(best.id) : null, status: best ? "Assigned" : "Triaged", estimate_cents: estimate } }],
        priority: (t.safety ? 3000 : t.priority === "Urgent" ? 2000 : 1000) + (best ? 10 : 0),
      };
    });
  },
});
