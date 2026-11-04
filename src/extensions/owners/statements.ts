import "server-only";
import { MANAGEMENT_FEE_RATE } from "@/lib/ledger";
import type { Db } from "@/lib/platform/types";
import { CURRENT_PERIOD } from "@/seed/constants";
import { effective } from "@/server/query";
import { formatDate } from "@/lib/format";

// Owner statements per entity per month, computed from trust transfers. A closed month is the
// transfers between two owner payouts (Lane A's period cutoff by seq); the open month is everything
// after the last payout. Every line carries the facts its explanation is built from.

export type Ctx = { db: Db; ws: string | null };
export type Period = { period: string; closed: boolean; distributionId: string | null; amount_cents: number | null; paid_on: string | null; status: string | null; gap_cents: number };
export type Entity = { id: string; name: string; owner_id: string; owner_name: string; state: string; reserve_cents: number; agreement_signed_on: string | null };
export type PropertyRow = { property_id: string; name: string; rent_cents: number; other_cents: number; returned_cents: number; returns: number; vendor_cents: number; fee_cents: number; deposits: number };
export type Payee = { vendor_id: string; name: string; count: number; amount_cents: number; property: string };
export type LineKey = "rent" | "other" | "returned" | "vendor" | "fee" | "reserve" | "distribution" | "gap";
export type Line = { key: LineKey; label: string; amount_cents: number; sign: 1 | -1; detail?: string; children?: { label: string; amount_cents: number; href?: string }[] };
export type Statement = {
  entity: Entity; period: string; closed: boolean; distributionId: string | null;
  range: { fromSeq: number; toSeq: number | null; fromId: string | null; toId: string | null };
  totals: { rent_cents: number; other_cents: number; returned_cents: number; income_cents: number; vendor_cents: number; fee_cents: number; pending_in_cents: number; items: number };
  distribution: { id: string; amount_cents: number; reserve_cents: number; income_cents: number; expense_cents: number; fee_cents: number; paid_on: string; transfer_id: string; status: string | null } | null;
  net_cents: number; gap_cents: number; properties: PropertyRow[]; payees: Payee[]; lines: Line[];
  issue: { id: string; rule_id: string; status: string } | null;
};

const ADJ = "key NOT LIKE 'owner-adj:%'";

export async function entityOf(c: Ctx, id: string): Promise<Entity | null> {
  return c.db
    .prepare(`SELECT e.id, e.name, e.owner_id, o.name AS owner_name, e.state, e.reserve_cents, e.agreement_signed_on FROM ${effective("owner_entities", c.ws)} e JOIN ${effective("owners", c.ws)} o ON o.id = e.owner_id WHERE e.id = ?`)
    .bind(id)
    .first<Entity>();
}

export async function entitiesOf(c: Ctx, ownerId?: string): Promise<(Entity & { properties: number })[]> {
  const { results } = await c.db
    .prepare(`SELECT e.id, e.name, e.owner_id, o.name AS owner_name, e.state, e.reserve_cents, e.agreement_signed_on, (SELECT count(*) FROM ${effective("properties", c.ws)} p WHERE p.owner_entity_id = e.id) AS properties
      FROM ${effective("owner_entities", c.ws)} e JOIN ${effective("owners", c.ws)} o ON o.id = e.owner_id WHERE (?1 IS NULL OR e.owner_id = ?1) ORDER BY e.name`)
    .bind(ownerId ?? null)
    .all<Entity & { properties: number }>();
  return results;
}

// Staff with property scope see an entity's statements only when it holds a property they cover.
export async function entityInScope(c: Ctx, entityId: string, propertyIds: string[] | "all") {
  if (propertyIds === "all") return true;
  return !!(await c.db.prepare(`SELECT 1 FROM ${effective("properties", c.ws)} p WHERE p.owner_entity_id = ? AND p.id IN (SELECT value FROM json_each(?)) LIMIT 1`).bind(entityId, JSON.stringify(propertyIds)).first());
}

// Closed months (newest first) plus the open month at the top.
export async function periodsOf(c: Ctx, entityId: string): Promise<Period[]> {
  const { results } = await c.db
    .prepare(`SELECT d.id, d.period, d.amount_cents, d.paid_on, t.status, (d.income_cents - d.expense_cents - d.fee_cents - d.reserve_cents - d.amount_cents
        - coalesce((SELECT a.amount_cents FROM ${effective("transfers", c.ws)} a WHERE a.key = 'owner-adj:' || d.id AND a.status <> 'Returned'), 0)) AS gap
      FROM ${effective("owner_distributions", c.ws)} d LEFT JOIN ${effective("transfers", c.ws)} t ON t.id = d.transfer_id
      WHERE d.owner_entity_id = ? ORDER BY d.period DESC, t.seq DESC`)
    .bind(entityId)
    .all<{ id: string; period: string; amount_cents: number; paid_on: string; status: string | null; gap: number }>();
  const closed: Period[] = results.map((r) => ({ period: r.period, closed: true, distributionId: r.id, amount_cents: r.amount_cents, paid_on: r.paid_on, status: r.status, gap_cents: r.gap }));
  // A distribution sent this month closes the current period; anything after it is the next one.
  const openPeriod = closed[0]?.period === CURRENT_PERIOD ? nextMonth(CURRENT_PERIOD) : CURRENT_PERIOD;
  return [{ period: openPeriod, closed: false, distributionId: null, amount_cents: null, paid_on: null, status: null, gap_cents: 0 }, ...closed];
}

export const nextMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};
export const prevMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};
export const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

// The seq window for a period: (previous payout, this payout] for closed months, (last payout, ∞) for the open one.
async function rangeOf(c: Ctx, entityId: string, period: string) {
  const t = effective("transfers", c.ws);
  const d = await c.db
    .prepare(`SELECT d.*, tr.seq AS seq, tr.status AS t_status FROM ${effective("owner_distributions", c.ws)} d JOIN ${t} tr ON tr.id = d.transfer_id WHERE d.owner_entity_id = ? AND d.period = ? ORDER BY tr.seq DESC LIMIT 1`)
    .bind(entityId, period)
    .first<{ id: string; seq: number; amount_cents: number; reserve_cents: number; income_cents: number; expense_cents: number; fee_cents: number; paid_on: string; transfer_id: string; t_status: string | null }>();
  const before = d ? d.seq : Number.MAX_SAFE_INTEGER;
  const prev = await c.db
    .prepare(`SELECT id, seq FROM ${t} x WHERE x.owner_entity_id = ? AND x.kind = 'Owner payout' AND x.status <> 'Returned' AND x.${ADJ} AND x.seq < ? ORDER BY x.seq DESC LIMIT 1`)
    .bind(entityId, before)
    .first<{ id: string; seq: number }>();
  return { dist: d, fromSeq: prev?.seq ?? 0, fromId: prev?.id ?? null, toSeq: d?.seq ?? null, toId: d?.transfer_id ?? null };
}

const ITEMS = (ws: string | null, join = "") => `${effective("transfers", ws)} t ${join} WHERE t.owner_entity_id = ?1 AND t.bank_account_id = 'ba-' || ?1 || '-trust' AND t.status <> 'Returned' AND t.kind <> 'Owner payout' AND t.seq > ?2 AND (?3 IS NULL OR t.seq < ?3)`;

async function aggregate(c: Ctx, entityId: string, fromSeq: number, toSeq: number | null) {
  const [props, payees] = await Promise.all([
    c.db
      .prepare(`SELECT t.property_id, p.name,
          coalesce(sum(CASE WHEN t.kind = 'Rent' AND t.status = 'Cleared' THEN t.amount_cents END), 0) AS rent_cents,
          coalesce(sum(CASE WHEN t.kind = 'Other receipt' AND t.status = 'Cleared' THEN t.amount_cents END), 0) AS other_cents,
          coalesce(sum(CASE WHEN t.kind = 'Returned payment' THEN t.amount_cents END), 0) AS returned_cents,
          sum(t.kind = 'Returned payment') AS returns,
          coalesce(sum(CASE WHEN t.kind = 'Vendor payout' THEN t.amount_cents END), 0) AS vendor_cents,
          coalesce(sum(CASE WHEN t.kind = 'Management fee' AND t.status = 'Cleared' THEN t.amount_cents END), 0) AS fee_cents,
          coalesce(sum(CASE WHEN t.kind IN ('Rent', 'Other receipt') AND t.status = 'Pending' THEN t.amount_cents END), 0) AS pending_cents,
          sum(t.kind = 'Rent') AS deposits, count(*) AS items
        FROM ${ITEMS(c.ws, `LEFT JOIN ${effective("properties", c.ws)} p ON p.id = t.property_id`)} AND t.kind IN ('Rent', 'Other receipt', 'Returned payment', 'Vendor payout', 'Management fee')
        GROUP BY t.property_id ORDER BY rent_cents DESC`)
      .bind(entityId, fromSeq, toSeq)
      .all<PropertyRow & { pending_cents: number; items: number }>(),
    c.db
      .prepare(`SELECT t.to_id AS vendor_id, t.to_name AS name, count(*) AS count, sum(t.amount_cents) AS amount_cents, min(t.property_id) AS property
        FROM ${ITEMS(c.ws)} AND t.kind = 'Vendor payout' GROUP BY t.to_id ORDER BY amount_cents DESC LIMIT 6`)
      .bind(entityId, fromSeq, toSeq)
      .all<Payee>(),
  ]);
  const sum = (k: keyof PropertyRow | "pending_cents" | "items") => props.results.reduce((a, r) => a + Number((r as Record<string, unknown>)[k] ?? 0), 0);
  return {
    properties: props.results.map((r) => ({ property_id: r.property_id, name: r.name, rent_cents: r.rent_cents, other_cents: r.other_cents, returned_cents: r.returned_cents, returns: r.returns, vendor_cents: r.vendor_cents, fee_cents: r.fee_cents, deposits: r.deposits })),
    payees: payees.results,
    totals: { rent_cents: sum("rent_cents"), other_cents: sum("other_cents"), returned_cents: sum("returned_cents"), income_cents: sum("rent_cents") + sum("other_cents") - sum("returned_cents"), vendor_cents: sum("vendor_cents"), fee_cents: sum("fee_cents"), pending_in_cents: sum("pending_cents"), items: sum("items") },
  };
}

export async function statementOf(c: Ctx, entityId: string, period: string): Promise<Statement | null> {
  const entity = await entityOf(c, entityId);
  if (!entity) return null;
  const r = await rangeOf(c, entityId, period);
  const closed = !!r.dist;
  if (!closed && period !== (await periodsOf(c, entityId))[0].period) return null;
  const agg = await aggregate(c, entityId, r.fromSeq, r.toSeq);
  const { totals } = agg;
  const net = totals.income_cents - totals.vendor_cents - totals.fee_cents;
  const d = r.dist;
  // A correction (Lane A's payOwnerAdjustment, key owner-adj:<distribution>) settles the gap.
  const adj = d ? await c.db.prepare(`SELECT t.amount_cents, t.created FROM ${effective("transfers", c.ws)} t WHERE t.key = 'owner-adj:' || ? AND t.status <> 'Returned'`).bind(d.id).first<{ amount_cents: number; created: string }>() : null;
  const gap = d ? d.income_cents - d.expense_cents - d.fee_cents - d.reserve_cents - d.amount_cents - (adj?.amount_cents ?? 0) : 0;
  const issue = d
    ? await c.db.prepare(`SELECT id, rule_id, status FROM ${effective("data_issues", c.ws)} i WHERE i.entity_type = 'owner_distributions' AND i.entity_id = ? ORDER BY i.detected_at DESC LIMIT 1`).bind(d.id).first<{ id: string; rule_id: string; status: string }>()
    : null;
  const byProp = (k: "rent_cents" | "vendor_cents" | "other_cents" | "returned_cents") => agg.properties.filter((p) => p[k] > 0).map((p) => ({ label: p.name, amount_cents: p[k], href: `/app/properties/${p.property_id}` }));
  const lines: Line[] = [
    { key: "rent", label: "Rent collected", amount_cents: totals.rent_cents, sign: 1, detail: `${agg.properties.reduce((a, p) => a + p.deposits, 0)} deposits into the operating trust`, children: byProp("rent_cents") },
    ...(totals.other_cents ? [{ key: "other" as const, label: "Other income", amount_cents: totals.other_cents, sign: 1 as const, detail: "Fees, parking, storage and utility recoveries", children: byProp("other_cents") }] : []),
    // A bounced payment comes back out of trust, so it counts against income (as Lane A's ownerStatement does).
    ...(totals.returned_cents ? [{ key: "returned" as const, label: "Returned payments", amount_cents: totals.returned_cents, sign: -1 as const, detail: "Rent the bank took back (NSF or a returned ACH)", children: byProp("returned_cents") }] : []),
    { key: "vendor", label: "Repairs and vendor payments", amount_cents: totals.vendor_cents, sign: -1, detail: `${agg.payees.reduce((a, p) => a + p.count, 0) || "No"} vendor payments`, children: byProp("vendor_cents") },
    { key: "fee", label: `Management fee (${Math.round(MANAGEMENT_FEE_RATE * 100)}%)`, amount_cents: totals.fee_cents, sign: -1, detail: "Charged on cleared rent and other income" },
  ];
  if (d) {
    if (d.reserve_cents) lines.push({ key: "reserve", label: d.reserve_cents > 0 ? "Added to operating reserve" : "Released from operating reserve", amount_cents: Math.abs(d.reserve_cents), sign: d.reserve_cents > 0 ? -1 : 1, detail: `Reserve target ${(entity.reserve_cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} per the management agreement` });
    if (adj) lines.push({ key: "gap", label: "Correction paid to owner", amount_cents: adj.amount_cents, sign: -1, detail: `Rounding shortfall paid ${adj.created.slice(0, 10)} by ACH` });
    if (gap) lines.push({ key: "gap", label: "Unreconciled difference", amount_cents: Math.abs(gap), sign: gap > 0 ? -1 : 1, detail: "The payout and the statement disagree" });
    lines.push({ key: "distribution", label: "Distributed to owner", amount_cents: d.amount_cents, sign: -1, detail: `Paid ${formatDate(d.paid_on, "always")} by ACH` });
  } else {
    lines.push({ key: "distribution", label: "Available to distribute", amount_cents: Math.max(net, 0), sign: -1, detail: totals.pending_in_cents ? "Pending deposits are added once they clear" : "Cleared items since the last payout" });
  }
  // A plain copy: rows from node:sqlite have a null prototype, and this goes to client components.
  return structuredClone({
    entity, period, closed, distributionId: d?.id ?? null,
    range: { fromSeq: r.fromSeq, toSeq: r.toSeq, fromId: r.fromId, toId: r.toId },
    totals,
    distribution: d ? { id: d.id, amount_cents: d.amount_cents, reserve_cents: d.reserve_cents, income_cents: d.income_cents, expense_cents: d.expense_cents, fee_cents: d.fee_cents, paid_on: d.paid_on, transfer_id: d.transfer_id, status: d.t_status } : null,
    net_cents: net, gap_cents: gap, properties: agg.properties, payees: agg.payees, lines, issue: issue ?? null,
  });
}

// ---------------------------------------------------------------------------------------------
// "Explain this line": facts and a looked-up trace for one statement line, then plain words.
// ---------------------------------------------------------------------------------------------

export type TraceItem = { label: string; detail: string; href?: string };
export type Explanation = { line: LineKey; label: string; text: string; facts: Record<string, string | number>; trace: TraceItem[] };

const usd = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const change = (now: number, before: number) => {
  const d = now - before;
  if (!before) return "";
  if (Math.abs(d) < 100) return ` It is about the same as the month before (${usd(before)}).`;
  return ` That is ${usd(Math.abs(d))} (${Math.abs(pctOf(d, before))}%) ${d > 0 ? "more" : "less"} than the month before (${usd(before)}).`;
};

export async function explainLine(c: Ctx, entityId: string, period: string, line: LineKey, staff: boolean): Promise<Explanation | null> {
  const st = await statementOf(c, entityId, period);
  if (!st) return null;
  const l = st.lines.find((x) => x.key === line);
  if (!l) return null;
  const prior = st.closed ? await statementOf(c, entityId, prevMonth(period)).catch(() => null) : null;
  const href = (h: string) => (staff ? h : undefined);
  const trace: TraceItem[] = [
    { label: "Owner entity", detail: `${st.entity.name} (${st.entity.id})`, href: href(`/app/owner-entities/${st.entity.id}`) },
    st.distribution
      ? { label: "Distribution record", detail: `${st.distribution.id}: income ${usd(st.distribution.income_cents)}, expenses ${usd(st.distribution.expense_cents)}, fee ${usd(st.distribution.fee_cents)}, paid ${usd(st.distribution.amount_cents)}`, href: href(`/app/owner-distributions/${st.distribution.id}`) }
      : { label: "Open statement", detail: `Transfers since the last payout${st.range.fromId ? "" : " (no payout yet)"}` },
    { label: "Trust transfers", detail: `${st.totals.items} transfers in the ${st.entity.name} trust account since ${st.range.fromId ? "the previous payout" : "the first payout"}` },
  ];
  if (prior) trace.push({ label: "Prior statement", detail: `${monthLabel(prior.period)}: ${prior.lines.map((x) => `${x.label.toLowerCase()} ${usd(x.amount_cents)}`).join(", ")}` });
  const facts: Record<string, string | number> = { entity: st.entity.name, period: monthLabel(period), line: l.label, amount: usd(l.amount_cents) };
  let text = "";

  if (line === "rent" || line === "other") {
    const key = line === "rent" ? "rent_cents" : "other_cents";
    const props = st.properties.filter((p) => p[key] > 0);
    const top = props[0];
    const before = prior ? prior.properties : [];
    const deltas = props.map((p) => ({ name: p.name, d: p[key] - (before.find((b) => b.property_id === p.property_id)?.[key] ?? 0) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    trace.push({ label: "Grouped by property", detail: props.map((p) => `${p.name} ${usd(p[key])}`).join("; ") || "No deposits", href: href(`/app/receivables/payments?f.property_id=${props.map((p) => p.property_id).join(",")}`) });
    facts.properties = props.length;
    if (top) facts.top_property = `${top.name} ${usd(top[key])}`;
    text = `${l.label} was ${usd(l.amount_cents)} across ${props.length} ${props.length === 1 ? "property" : "properties"}${st.totals.pending_in_cents && !st.closed ? `, with ${usd(st.totals.pending_in_cents)} more still clearing` : ""}.`;
    if (top && props.length > 1) text += ` ${top.name} brought in the most: ${usd(top[key])} (${pctOf(top[key], l.amount_cents)}%).`;
    if (prior) {
      const p = prior.lines.find((x) => x.key === line)?.amount_cents ?? 0;
      text += change(l.amount_cents, p);
      if (deltas[0] && Math.abs(deltas[0].d) >= 100 && Math.abs(l.amount_cents - p) >= 100) text += ` The biggest change was at ${deltas[0].name} (${deltas[0].d > 0 ? "+" : ""}${usd(deltas[0].d)}).`;
    }
  } else if (line === "returned") {
    const props = st.properties.filter((p) => p.returned_cents > 0).sort((a, b) => b.returned_cents - a.returned_cents);
    const n = props.reduce((a, p) => a + p.returns, 0);
    facts.returns = n;
    trace.push({ label: "Returned payments", detail: props.map((p) => `${p.name} ${usd(p.returned_cents)} (${p.returns})`).join("; "), href: href(`/app/receivables/payments?f.nsf=true&f.property_id=${props.map((p) => p.property_id).join(",")}`) });
    text = `${n} resident payment${n === 1 ? "" : "s"} totaling ${usd(l.amount_cents)} bounced (NSF or a returned ACH), so the bank took the money back out of the trust account. It comes off this statement's income${props[0] ? `; the largest was at ${props[0].name} (${usd(props[0].returned_cents)})` : ""}. The residents owe that rent again, and the management fee charged on those payments went back to the trust account.`;
  } else if (line === "vendor") {
    trace.push({ label: "Vendor payouts by payee", detail: st.payees.map((p) => `${p.name} ${usd(p.amount_cents)} (${p.count})`).join("; ") || "None", href: href(`/app/payables/bills?f.property_id=${st.properties.map((p) => p.property_id).join(",")}`) });
    const n = st.payees.reduce((a, p) => a + p.count, 0);
    facts.payments = n;
    text = n ? `${usd(l.amount_cents)} went to vendors in ${n} payment${n === 1 ? "" : "s"}.` : "No vendor payments came out of the trust account in this period.";
    const top = st.payees[0];
    if (top) text += ` The largest payee was ${top.name}: ${usd(top.amount_cents)} over ${top.count} payment${top.count === 1 ? "" : "s"} (${pctOf(top.amount_cents, l.amount_cents)}% of the total).`;
    if (prior) text += change(l.amount_cents, prior.totals.vendor_cents);
    const props = st.properties.filter((p) => p.vendor_cents > 0).sort((a, b) => b.vendor_cents - a.vendor_cents);
    if (props.length > 1) text += ` ${props[0].name} accounted for ${usd(props[0].vendor_cents)}.`;
  } else if (line === "fee") {
    const base = st.totals.rent_cents + st.totals.other_cents;
    const flat = Math.round(base * MANAGEMENT_FEE_RATE);
    facts.fee_base = usd(base);
    facts.rate = `${Math.round(MANAGEMENT_FEE_RATE * 100)}%`;
    trace.push({ label: "Management fee transfers", detail: "One fee per cleared deposit, paid to the management company and rounded to the cent" });
    text = `The management agreement sets the fee at ${Math.round(MANAGEMENT_FEE_RATE * 100)}% of cleared rent and other income. ${Math.round(MANAGEMENT_FEE_RATE * 100)}% of ${usd(base)} is ${usd(flat)}; the fee charged was ${usd(l.amount_cents)}.`;
    text += flat === l.amount_cents ? " They match exactly." : ` The ${usd(Math.abs(flat - l.amount_cents))} difference ${Math.abs(flat - l.amount_cents) > st.totals.items ? "is more than rounding each deposit's fee would explain. Check the fee transfers for this period." : "comes from rounding each deposit's fee to the cent."}`;
  } else if (line === "reserve") {
    facts.reserve_target = usd(st.entity.reserve_cents);
    text = `The management agreement keeps ${usd(st.entity.reserve_cents)} in the trust account as an operating reserve before anything is distributed. ${l.sign < 0 ? `This month ${usd(l.amount_cents)} was held back to bring the reserve up to that target.` : `This month ${usd(l.amount_cents)} of reserve was released.`}`;
  } else if (line === "gap") {
    facts.gap = usd(st.gap_cents);
    trace.push({ label: "Data Health", detail: st.issue ? `Issue ${st.issue.id} (${st.issue.rule_id}), ${st.issue.status}` : "Rule owner_distributions.rounding_cent", href: href(st.issue ? `/app/data-health?issue=${st.issue.id}` : "/app/data-health") });
    if (!st.gap_cents) {
      text = `The original payout was ${usd(l.amount_cents)} short because of a rounding error. That correction has been paid to ${st.entity.owner_name}, so this statement now reconciles to $0.00.`;
    } else text = `Income less expenses, the fee and the reserve comes to ${usd(st.net_cents - (st.distribution?.reserve_cents ?? 0))}, but ${usd(st.distribution?.amount_cents ?? 0)} was paid. The ${usd(Math.abs(st.gap_cents))} ${st.gap_cents > 0 ? "is still in the trust account and is owed to the owner" : "was overpaid"}. The payout was rounded wrong; no transaction is missing. Paying the owner the difference fixes it.`;
  } else {
    const d = st.distribution;
    if (d) {
      facts.net = usd(d.income_cents - d.expense_cents - d.fee_cents);
      trace.push({ label: "Payout transfer", detail: `${d.transfer_id}, ${d.status === "Pending" ? "on its way" : d.status === "Cleared" ? "cleared" : d.status ?? "unknown"}` });
      text = `Income of ${usd(d.income_cents)} less vendor payments of ${usd(d.expense_cents)} and the management fee of ${usd(d.fee_cents)} leaves ${usd(d.income_cents - d.expense_cents - d.fee_cents)}.`;
      if (d.reserve_cents) text += ` ${usd(Math.abs(d.reserve_cents))} was ${d.reserve_cents > 0 ? "kept in" : "released from"} the operating reserve.`;
      text += ` ${usd(d.amount_cents)} was paid to ${st.entity.owner_name} on ${formatDate(d.paid_on, "always")} by ACH.`;
      if (prior?.distribution) text += change(d.amount_cents, prior.distribution.amount_cents).replace("the month before", `${monthLabel(prior.period)}'s distribution`);
    } else {
      text = `So far this month: ${usd(st.totals.income_cents)} of income has cleared, less ${usd(st.totals.vendor_cents)} of vendor payments and ${usd(st.totals.fee_cents)} of fees, leaving ${usd(st.net_cents)} to distribute.${st.totals.pending_in_cents ? ` Another ${usd(st.totals.pending_in_cents)} is still clearing.` : ""} The statement closes when the distribution is sent.`;
    }
  }
  return { line, label: l.label, text, facts, trace };
}
