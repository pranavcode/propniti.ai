import { getEntity } from "@/entities";
import { INTERNAL_ROLES, type EntityDef, type Facts, type Row } from "@/entities/types";
import { formatDate, formatMoney } from "@/lib/format";
import { getRow } from "@/server/query";
import { sql, type DataCtx } from "./data";
import { cachedSummary, factsFor } from "./summaries";

// "Ask about this": what the assistant knows about the record a person is looking at. The panel
// shows a card and questions for the record's type; a question about it gets the record up front
// (related records by name, never internal ids), so the model can answer without looking it up.

const QUESTIONS: Record<string, (r: Row) => string[]> = {
  work_orders: (r) => ["Why is this taking long?", "Which vendor should handle this?", r.estimate != null && Number(r.estimate) > 0 ? `Is the ${formatMoney(Number(r.estimate), "whole")} estimate normal for this job?` : "What's the next step on this job?"],
  leases: () => ["Is this resident behind on rent?", "Should we renew this lease, and at what rent?", "What's coming up on this lease?"],
  residents: () => ["Does this resident owe anything?", "What open requests do they have?", "When does their lease end?"],
  properties: () => ["How is this property doing this month?", "What needs attention here?", "Why did NOI change here?"],
  bills: () => ["Is this bill normal for this vendor?", "Who needs to approve this bill?", "Is anything blocking payment of this bill?"],
  vendors: () => ["How has this vendor performed?", "Is this vendor's insurance current?", "What open jobs does this vendor have?"],
  applications: () => ["Where does this application stand?", "What's still missing on this application?", "How is this applicant's score worked out?"],
  units: () => ["Is this unit rent-ready?", "How does this unit's rent compare with market?", "What work has this unit needed?"],
};
const GENERIC = ["Summarize this record", "What needs attention here?", "What happened here recently?"];

export function aboutQuestions(entity: string, row: Row): string[] {
  return QUESTIONS[entity]?.(row) ?? GENERIC;
}

// Questions that refer to the record in view rather than the whole portfolio.
export const ABOUT_RECORD = /\b(this|it|its|here|they|them|their|he|she|his|her)\b|^\s*(tell me about|summari[sz]e|explain)\b/i;

const SKIP = new Set(["id", "workspace_id", "deleted", "seq"]);

// One field as a person reads it: related records by name, money and dates formatted. Null when
// the value is empty or would only be an internal id.
function shown(def: EntityDef, key: string, row: Row): string | null {
  const f = def.fields[key];
  const v = row[key];
  if (!f || v == null || v === "") return null;
  if (f.type === "ref") return typeof row[`${key}__label`] === "string" && row[`${key}__label`] ? String(row[`${key}__label`]) : null;
  if (f.type === "money") return formatMoney(Number(v));
  if (f.type === "date") return formatDate(String(v), "always");
  if (f.type === "datetime") return formatDate(String(v), "always");
  if (f.type === "bool") return v ? "Yes" : "No";
  if (f.type === "json" || f.type === "image" || typeof v === "object") return null;
  return String(v).slice(0, 300);
}

export type RecordBrief = {
  entity: string; id: string; type: string; title: string; label: string; href: string; status?: string;
  // Field label → value, in the order the record page shows them.
  fields: Record<string, string>; facts: Facts; summary?: { text: string; source: string; model: string };
  // Ids a person shouldn't see in an answer, and the record's money in cents (figure checks).
  hidden: string[]; cents: number[]; row: Row;
  // Work orders: finished jobs of the same trade, in cents.
  compare?: { trade: string; jobs: number; low: number; high: number; avg: number; estimate: number | null };
};

export async function recordBrief(data: DataCtx, entity: string, id: string): Promise<RecordBrief | null> {
  const def = getEntity(entity);
  if (!def) return null;
  const row = await getRow({ db: data.db, ws: data.ws === "base" ? null : data.ws, actor: data.actor }, entity, id).catch(() => null);
  if (!row) return null;
  const title = String(row[def.titleField] ?? id);
  const overview = def.detail.tabs.find((t): t is { key: string; label: string; fields: string[] } => "fields" in t && Array.isArray(t.fields));
  const keys = [...new Set([...def.detail.facts, ...(overview?.fields ?? [])])].filter((k) => !SKIP.has(k) && k !== def.titleField);
  const fields: Record<string, string> = {};
  for (const k of keys) {
    const v = shown(def, k, row);
    if (v != null) fields[def.fields[k].label] = v;
  }
  const hidden = [...new Set([...Object.entries(def.fields).filter(([, f]) => f.type === "ref").map(([k]) => row[k]), ...(def.idFormat ? [] : [id])].filter((v): v is string => typeof v === "string" && v.length > 0))];
  const cents = Object.entries(def.fields).filter(([k, f]) => f.type === "money" && row[k] != null).map(([k]) => Math.round(Number(row[k]) * 100));
  const [f, s] = await Promise.all([factsFor(data, entity, id, row).catch(() => null), cachedSummary(data, entity, id, row).catch(() => null)]);
  // Model-facing facts from the entity def, minus any value that is only an internal id.
  const facts: Facts = Object.fromEntries(Object.entries(f?.facts ?? {}).filter(([, v]) => !(typeof v === "string" && hidden.includes(v))));
  for (const [k, v] of Object.entries(facts)) if (typeof v === "number" && /amount|balance|rent|estimate|cost|spend|price|deposit|total|income|noi/i.test(k)) cents.push(Math.round(v * 100));
  // Work orders: what finished jobs of the same trade cost, so "is this estimate normal?" is
  // answered from figures in the data rather than a model's guess. Staff only: the query is scoped
  // by property, so for a resident or vendor it would include other households' jobs and other
  // vendors' prices.
  const staff = (INTERNAL_ROLES as readonly string[]).includes(data.actor.role) && data.actor.scope.kind !== "self";
  let compare: RecordBrief["compare"];
  if (staff && entity === "work_orders" && row.category) {
    const [j] = await sql<{ jobs: number; low: number | null; high: number | null; avg: number | null }>(data, "SELECT count(*) AS jobs, min(cost_cents) AS low, max(cost_cents) AS high, CAST(round(avg(cost_cents)) AS INTEGER) AS avg FROM {work_orders} WHERE category = ? AND cost_cents > 0 AND id <> ?", [String(row.category), id]).catch(() => []);
    if (j?.jobs) {
      fields[`Finished ${String(row.category).toLowerCase()} jobs`] = `${j.jobs} cost ${formatMoney(j.low! / 100)} to ${formatMoney(j.high! / 100)}, ${formatMoney(j.avg! / 100)} on average`;
      cents.push(j.low!, j.high!, j.avg!);
      compare = { trade: String(row.category), jobs: j.jobs, low: j.low!, high: j.high!, avg: j.avg!, estimate: row.estimate == null ? null : Math.round(Number(row.estimate) * 100) };
    }
  }
  const status = typeof row.status === "string" ? row.status : undefined;
  return {
    entity, id, type: def.label.one, title, label: def.idFormat ? id : title, href: `${def.route}/${encodeURIComponent(id)}`, status,
    fields, facts, summary: s ? { text: s.summary, source: s.source, model: s.model } : undefined, hidden, cents, row, compare,
  };
}

// "Is this estimate normal?" is a fact question: answered from the computed comparison, not a model.
export const ASKS_COST = /\b(estimate|cost|price|quote|expensive|cheap|reasonable|normal)\b/i;
export function costAnswer(b: RecordBrief): string | null {
  const c = b.compare;
  if (!c) return null;
  const m = (cents: number) => formatMoney(cents / 100);
  const range = `${c.jobs} finished ${c.trade.toLowerCase()} job${c.jobs === 1 ? "" : "s"} cost ${m(c.low)} to ${m(c.high)}, ${m(c.avg)} on average`;
  if (c.estimate == null) return `This job has no estimate yet. For comparison, ${range}.`;
  const where = c.estimate > c.high ? "above the most expensive of them" : c.estimate < c.low ? "below the cheapest of them" : c.estimate > c.avg * 1.25 ? "within their range but above average" : c.estimate < c.avg * 0.75 ? "within their range but below average" : "close to their average";
  return `The ${m(c.estimate)} estimate is ${where}: ${range}.`;
}

// The rules answer about a record: its summary (stored model text while current, else rules) and
// its facts in one sentence, by name.
export function briefSentence(b: RecordBrief) {
  const facts = Object.entries(b.fields).filter(([k]) => k !== "Status" && k !== "Description").slice(0, 8).map(([k, v]) => `${k.toLowerCase()} ${v}`);
  const head = `${b.type} ${b.label === b.title ? `"${b.title}"` : `${b.label}, "${b.title}",`}${b.status ? ` is ${b.status}` : ""}.`;
  return `${head}${facts.length ? ` Key facts: ${facts.join(", ")}.` : ""}`;
}
export const recordAnswer = (b: RecordBrief) => (b.summary && b.summary.source !== "rules" ? `${b.summary.text} ${briefSentence(b)}` : briefSentence(b));

export type AboutCard = {
  entity: string; id: string; type: string; title: string; href: string; status?: string;
  facts: { label: string; value: string }[]; summary?: { text: string; source: string; model: string }; questions: string[];
};

// The card the panel shows when "Ask about this" opens it: no model call, one record read.
export async function aboutCard(data: DataCtx, entity: string, id: string): Promise<AboutCard | null> {
  const b = await recordBrief(data, entity, id);
  if (!b) return null;
  const def = getEntity(entity)!;
  const facts = def.detail.facts.filter((k) => k !== "status" && k !== def.titleField).map((k) => ({ label: def.fields[k]?.label ?? k, value: shown(def, k, b.row) })).filter((x): x is { label: string; value: string } => x.value != null).slice(0, 4);
  return { entity, id, type: b.type, title: b.title, href: b.href, status: b.status, facts, summary: b.summary, questions: aboutQuestions(entity, b.row) };
}
