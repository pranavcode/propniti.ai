import { z } from "zod";
import { INTERNAL_ROLES, type Row } from "@/entities/types";
import { get, list, parseJson, sql, TABLES, columns, type Filter, type Table } from "../data";
import { delinquency, explainNoi, monthly } from "../facts";
import type { AgentCtx } from "../runtime";
import type { RunContext } from "../types";
import { registerTool } from "./registry";

// Read tools. Every one reads through src/ai/data.ts: overlay over base, limited to the actor's
// properties, paginated. They never change anything, so they never need approval.

const ac = (ctx: RunContext) => ctx as unknown as AgentCtx;
const roles = [...INTERNAL_ROLES];
const never = () => false;
const SEARCHABLE = Object.keys(TABLES).filter((t) => !t.startsWith("assistant_") && t !== "agent_steps") as Table[];
const entity = z.enum(SEARCHABLE as [Table, ...Table[]]);

// Long text and image lists don't help the model; trim them so results stay small.
export function slim(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "photos" || k === "floorplan_svg" || k === "amenities") continue;
    out[k] = typeof v === "string" && v.length > 300 ? v.slice(0, 300) + "…" : v;
  }
  return out;
}

const FilterSchema = z.object({
  field: z.string().describe("column name"),
  op: z.enum(["eq", "ne", "in", "nin", "gt", "gte", "lt", "lte", "like", "null", "notnull"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])).max(1000)]).optional(),
});

registerTool({
  key: "records.search",
  description: "List records of one entity (a database table) with filters on its columns, sorted and paged. Money columns end in _cents. Use for counts and lists.",
  input: z.object({
    entity,
    filters: z.array(FilterSchema).max(8).default([]),
    q: z.string().max(100).optional().describe("text search across name/title fields"),
    sort: z.tuple([z.string(), z.enum(["asc", "desc"])]).optional(),
    page: z.number().int().min(1).default(1),
    size: z.number().int().min(1).max(50).default(20),
  }),
  output: z.any(),
  mode: "read", roles, requiresApproval: never,
  async run(ctx, i) {
    const r = await list(ac(ctx).data, i.entity, { filters: i.filters, sort: i.sort, page: i.page, size: i.size, q: i.q, qFields: ["name", "title", "first_name", "last_name", "company", "number", "invoice_number"] });
    return { entity: i.entity, total: r.total, page: r.page, size: r.size, rows: r.rows.map(slim) };
  },
});

registerTool({
  key: "records.get",
  description: "Fetch one record by entity and id.",
  input: z.object({ entity, id: z.string().max(80) }),
  output: z.any(),
  mode: "read", roles, requiresApproval: never,
  async run(ctx, i) {
    const row = await get(ac(ctx).data, i.entity, i.id);
    if (!row) throw new Error(`${i.entity} ${i.id} not found or outside your scope`);
    return slim(row);
  },
});

// Child rows that point at the record through a "<singular>_id" column (leases → charges.lease_id).
const singular = (t: string) => (t.endsWith("ies") ? t.slice(0, -3) + "y" : t.replace(/s$/, ""));
registerTool({
  key: "records.related",
  description: "List records of another entity linked to a record, e.g. charges of a lease, work orders of a unit, bills of a vendor, screening results of an application.",
  input: z.object({ entity, id: z.string().max(80), related: entity, size: z.number().int().min(1).max(50).default(20) }),
  output: z.any(),
  mode: "read", roles, requiresApproval: never,
  async run(ctx, i) {
    const fk = `${singular(i.entity)}_id`;
    const cols = await columns(ac(ctx).db, i.related);
    if (!cols.has(fk)) throw new Error(`${i.related} has no ${fk} column; no direct link from ${i.entity}`);
    const sort: [string, "asc" | "desc"] | undefined = ["due_on", "received_on", "opened_at", "created_at", "sent_at", "on_date"].filter((c) => cols.has(c)).map((c) => [c, "desc"] as [string, "desc"])[0];
    const r = await list(ac(ctx).data, i.related, { filters: [{ field: fk, op: "eq", value: i.id }], sort, size: i.size });
    return { total: r.total, rows: r.rows.map(slim) };
  },
});

registerTool({
  key: "ledger.delinquency",
  description: "Residents who owe rent: balance, days late and aging buckets per lease, computed from charges, payments and credits. Filter by minimum days late, metro (Austin, Dallas, Atlanta, Phoenix) or property ids.",
  input: z.object({ min_days: z.number().int().min(0).optional(), metro: z.enum(["Austin", "Dallas", "Atlanta", "Phoenix"]).optional(), property_ids: z.array(z.string()).max(30).optional(), limit: z.number().int().min(1).max(50).default(25) }),
  output: z.any(),
  mode: "read", roles, requiresApproval: never,
  async run(ctx, i) {
    const c = ac(ctx);
    return delinquency(c.data, c.today, { minDays: i.min_days, metro: i.metro, propertyIds: i.property_ids, limit: i.limit });
  },
});

registerTool({
  key: "ledger.lookup",
  description: "A lease's ledger: recent charges, payments (with NSF returns) and credits, and the current balance.",
  input: z.object({ lease_id: z.string().max(80) }),
  output: z.any(),
  mode: "read", roles, requiresApproval: never,
  async run(ctx, i) {
    const c = ac(ctx);
    const lease = await get(c.data, "leases", i.lease_id);
    if (!lease) throw new Error(`Lease ${i.lease_id} not found or outside your scope`);
    const [charges, payments, credits, bal] = await Promise.all([
      sql(c.data, "SELECT id, description, period, due_on, amount_cents FROM {charges} WHERE lease_id = ? ORDER BY due_on DESC LIMIT 12", [i.lease_id]),
      sql(c.data, "SELECT id, method, received_on, amount_cents, nsf FROM {payments} WHERE lease_id = ? ORDER BY received_on DESC LIMIT 12", [i.lease_id]),
      sql(c.data, "SELECT id, kind, description, on_date, amount_cents FROM {credits} WHERE lease_id = ? ORDER BY on_date DESC LIMIT 6", [i.lease_id]),
      delinquency(c.data, c.today, { leaseIds: [i.lease_id] }),
    ]);
    return { lease: slim(lease), balance_cents: bal.rows[0]?.balance_cents ?? 0, days_late: bal.rows[0]?.days_late ?? 0, charges, payments, credits };
  },
});

registerTool({
  key: "metrics.monthly",
  description: "Monthly property metrics: NOI, collected, occupancy, aging, opex, work orders, leasing funnel, AI actions. Optional metro or property ids; months back (max 18).",
  input: z.object({ metro: z.enum(["Austin", "Dallas", "Atlanta", "Phoenix"]).optional(), property_ids: z.array(z.string()).max(30).optional(), months: z.number().int().min(1).max(18).default(3) }),
  output: z.any(),
  mode: "read", roles, requiresApproval: never,
  async run(ctx, i) {
    const rows = await monthly(ac(ctx).data, { metro: i.metro, propertyIds: i.property_ids, months: i.months });
    return { rows: rows.slice(0, 120) };
  },
});

registerTool({
  key: "metrics.explain_noi",
  description: "Explains a change in NOI month over month: drivers that add up to the change (operating expenses, vacancy loss, concessions, other income), the properties that moved most and the expense lines that changed. All figures computed.",
  input: z.object({ metro: z.enum(["Austin", "Dallas", "Atlanta", "Phoenix"]).optional(), property_ids: z.array(z.string()).max(30).optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
  output: z.any(),
  mode: "read", roles, requiresApproval: never,
  async run(ctx, i) {
    const c = ac(ctx);
    return (await explainNoi(c.data, { metro: i.metro, propertyIds: i.property_ids, month: i.month, today: c.today })) ?? { error: "Not enough monthly history" };
  },
});

registerTool({
  key: "data.issues",
  description: "Open data-quality issues found by the data-health rules (duplicates, bad dates, miscoded GL, unverified bank changes…), with the suggested fix.",
  input: z.object({ status: z.enum(["open", "fixed", "dismissed", "auto-fixed"]).default("open"), rule_id: z.string().optional(), entity_type: z.string().optional(), property_id: z.string().optional(), size: z.number().int().min(1).max(50).default(25) }),
  output: z.any(),
  mode: "read", roles, requiresApproval: never,
  async run(ctx, i) {
    const filters: Filter[] = [{ field: "status", op: "eq", value: i.status }];
    if (i.rule_id) filters.push({ field: "rule_id", op: "eq", value: i.rule_id });
    if (i.entity_type) filters.push({ field: "entity_type", op: "eq", value: i.entity_type });
    if (i.property_id) filters.push({ field: "property_id", op: "eq", value: i.property_id });
    const r = await list(ac(ctx).data, "data_issues", { filters, sort: ["severity", "asc"], size: i.size });
    return { total: r.total, rows: r.rows.map((x) => ({ ...x, evidence: parseJson(x.evidence, {}), suggested_fix: parseJson(x.suggested_fix, null) })) };
  },
});

registerTool({
  key: "help.search",
  description: "Search the product help articles (how to do something in Propniti). Returns titles, snippets and links.",
  input: z.object({ query: z.string().min(2).max(200) }),
  output: z.any(),
  mode: "read", roles: [...roles, "owner", "resident", "vendor", "applicant"], requiresApproval: never,
  async run(ctx, i) {
    return { articles: await searchHelp(ac(ctx), i.query) };
  },
});

const STOP = new Set(["how", "do", "does", "did", "i", "a", "an", "the", "to", "in", "of", "for", "and", "or", "is", "are", "can", "my", "what", "where", "when", "with", "on", "it", "you", "me", "we", "about", "there", "that", "this"]);
// Words are compared by stem, so "scoring", "scores" and "score" match, as do "application" and
// "applicant". A few product synonyms widen the query.
const stem = (w: string) => w.replace(/(ations?|ants?|ings?|ions?|ers?|ed|es|s|e)$/, (m, _s, at: number) => (at >= 3 ? "" : m));
const SYNONYMS = new Map<string, string[]>();
for (const group of [["score", "rank", "rating"], ["tenant", "resident"], ["invoice", "bill"], ["repair", "maintenance", "fix"], ["late", "delinquent", "overdue"], ["payment", "pay"]]) {
  for (const w of group) SYNONYMS.set(stem(w), group.filter((x) => x !== w).map(stem));
}
const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
// Every word and its stem, so a short word the stemmer cuts badly still matches itself.
const vocab = (text: string) => new Set(words(text).flatMap((w) => [w, stem(w)]));

export async function searchHelp(ctx: AgentCtx, query: string) {
  // "How does X work?" asks about X; "work" alone would match every work-order article.
  const q = /^\s*how (does|do|did)\b/i.test(query) ? query.replace(/\bworks?\s*\??\s*$/i, "") : query;
  const asked = [...new Set(words(q))];
  const stems = asked.map(stem);
  const terms = [
    ...asked.map((w) => ({ any: [w, stem(w)], w: 1 })),
    ...stems.flatMap((t) => (SYNONYMS.get(t) ?? []).filter((x) => !stems.includes(x)).map((x) => ({ any: [x], w: 0.5 }))),
  ];
  const rows = await sql<{ id: string; title: string; body: string; tags: string; route: string | null }>(ctx.data, "SELECT id, title, body, tags, route FROM {help_articles} LIMIT 500", [], { unscoped: true });
  return rows
    .map((r) => {
      const [title, tags, body] = [vocab(r.title), vocab(r.tags), vocab(r.body)];
      const has = (set: Set<string>, any: string[]) => any.some((x) => set.has(x));
      const score = terms.reduce((s, { any, w }) => s + w * ((has(title, any) ? 3 : 0) + (has(tags, any) ? 2 : 0) + (has(body, any) ? 1 : 0)), 0);
      const lower = r.body.toLowerCase();
      const at = Math.max(0, stems.map((t) => lower.indexOf(t)).filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? 0);
      return { slug: r.id, title: r.title, snippet: r.body.slice(Math.max(0, at - 80), at + 320).replace(/\s+/g, " ").trim(), href: `/app/help/${r.id}`, route: r.route, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

registerTool({
  key: "policy.lookup",
  description: "Approval policies (who approves what, auto-approve limits, owner approval thresholds), state rules (late-fee caps, grace days, notice periods) and late-fee policies.",
  input: z.object({ category: z.string().optional(), state: z.string().length(2).optional() }),
  output: z.any(),
  mode: "read", roles, requiresApproval: never,
  async run(ctx, i) {
    const d = ac(ctx).data;
    const [policies, rules, fees] = await Promise.all([
      sql(d, `SELECT category, limit_cents, approver_role, owner_approval_over_cents, always_human, owner_entity_id FROM {approval_policies} ${i.category ? "WHERE category = ?" : ""}`, i.category ? [i.category] : []),
      sql(d, `SELECT state, rule, value, note FROM {state_rules} ${i.state ? "WHERE state = ?" : ""}`, i.state ? [i.state] : []),
      sql(d, "SELECT property_id, grace_days, kind, flat_cents, pct, daily_cents, max_cents FROM {late_fee_policies} LIMIT 40"),
    ]);
    return { approval_policies: policies, state_rules: rules, late_fee_policies: fees };
  },
});
