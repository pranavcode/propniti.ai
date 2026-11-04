import { sql } from "../data";
import { monthly, type NoiExplanation } from "../facts";
import { defineAgent, money, type Candidate } from "./framework";
import { explainText } from "../rules";
export { explainText } from "../rules";

// Variance explanations for owners: when an owner entity's NOI moved more than 3% month over month,
// explain why from computed drivers and offer the note to the owner.

export default defineAgent({
  key: "owner_reporting",
  name: "Owner Reporting agent",
  ownerRole: "accountant",
  goal: "Explain every owner's NOI change of more than 3% month over month in plain English, built only from computed drivers (rent collected, expenses, vacancy, concessions, expense lines), and offer the note to the owner.",
  tools: ["metrics.explain_noi", "metrics.monthly", "records.search", "messages.draft", "actions.propose"],
  triggers: { schedule: "0 12 1 * *", events: ["statement.closed"] },
  autonomy: "act_with_approval",
  entities: ["owner_entities", "owner_distributions"],
  actions: ["owner_entities.send_explanation"],
  maxProposals: 6,
  async collect(ctx) {
    const entities = await sql<{ id: string; name: string; owner_id: string; props: string }>(ctx.data,
      "SELECT e.id, e.name, e.owner_id, (SELECT json_group_array(p.id) FROM {properties} p WHERE p.owner_entity_id = e.id) AS props FROM {owner_entities} e", [], { unscoped: true });
    // One cheap pass over the stored monthly NOI picks the entities whose NOI moved most; only
    // those (at most three per run) get the full explanation, which reads the journal.
    const months = await monthly(ctx.data, { months: 3 });
    const latest = [...new Set(months.map((m) => String(m.month)))].sort().slice(-3, -1);
    const noi = (ids: string[], month: string | undefined) => months.filter((m) => m.month === month && ids.includes(String(m.property_id))).reduce((s, m) => s + Number(m.noi_cents), 0);
    const ranked = entities
      .map((e) => ({ e, ids: (JSON.parse(e.props) as string[]).filter((id) => ctx.actor.propertyIds === "all" || ctx.actor.propertyIds.includes(id)) }))
      .filter((x) => x.ids.length)
      .map((x) => ({ ...x, move: Math.abs(noi(x.ids, latest[1]) - noi(x.ids, latest[0])) / Math.max(1, Math.abs(noi(x.ids, latest[0]))) }))
      .sort((a, b) => b.move - a.move)
      .slice(0, 3);
    const out: Candidate[] = [];
    for (const { e, ids } of ranked) {
      const x = await ctx.call<NoiExplanation | { error: string }>("metrics.explain_noi", { property_ids: ids });
      if ("error" in x || Math.abs(x.change_pct) < 3) continue;
      const text = explainText(x);
      out.push({
        entity: "owner_entities", entityId: e.id, action: "owner_entities.send_explanation", propertyId: ids.length === 1 ? ids[0] : null,
        title: `Explain ${e.name}'s ${x.change_pct < 0 ? "NOI drop" : "NOI rise"} of ${Math.abs(x.change_pct)}% in ${x.month}`,
        why: [text, x.budget_noi_cents != null ? `Budget NOI for ${x.month} was ${money(x.budget_noi_cents)}` : "No budget on file for this month"].slice(0, 2),
        confidence: 0.85, risk: "Low",
        facts: { owner_entity: e.name, month: x.month, noi_cents: x.noi_cents, prior_noi_cents: x.prior_noi_cents, change_pct: x.change_pct, ...Object.fromEntries(x.drivers.map((d, i) => [`driver_${i + 1}_cents`, Math.abs(d.delta_cents)])), ...(x.expense_lines[0] ? { top_expense_delta_cents: Math.abs(x.expense_lines[0].delta_cents) } : {}) },
        extra: { explanation: x },
        evidence: x.by_property.slice(0, 3).map((p) => ({ entity_type: "properties", entity_id: p.property_id, label: `${p.property}: ${money(p.change_cents)}` })),
        message: { party_kind: "owner", party_id: e.owner_id, subject: `Why NOI changed in ${x.month}`, body: `${text}\n\nEvery figure comes from your ${x.month} statement; reply with any questions.` },
        effects: [], priority: Math.round(Math.abs(x.change_pct) * 10),
      });
    }
    return out;
  },
});
