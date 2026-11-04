import { modelName } from "@/components/app/ai/model";

// The run trace in plain words. Each row of the trace is one sentence built from the step data:
// a tool call and its result read as one row ("Looked up 14 prospects"), and the actions.propose
// call that made a proposal folds into that proposal. Records are linked by name through `refs`,
// which the server fills only with records the viewer may see; anything else shows its type only.
// The raw input and output stay on each row under "Technical details".

export type TraceStepLike = { idx: number; kind: string; toolKey?: string; input?: unknown; output?: unknown; latencyMs?: number; tokens?: number; ok: boolean; at: string; summary?: string };

export type RecordRef = { type: string; name?: string; href?: string; property?: string };
export type TraceRefs = {
  records: Record<string, RecordRef>;                    // "<entity>:<id>" → display name, link and property
  entities: Record<string, { one: string; many: string }>;
  actions: Record<string, string>;                       // action key → label ("Send follow-up")
  proposals: Record<string, string>;                     // proposal id → "<entity>:<id>"
};
export const NO_REFS: TraceRefs = { records: {}, entities: {}, actions: {}, proposals: {} };

export type Part = string | { text: string; href?: string };
export type Sentence = { parts: Part[]; quote?: string };
export type TraceRow = { steps: TraceStepLike[]; main: TraceStepLike; status: "running" | "done" | "failed"; sentence: Sentence };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const words = (key: string) => key.replace(/[_.]+/g, " ").trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const article = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
// Table keys to a singular noun when the registry has no label: "work_orders" → "work order".
const singular = (t: string) => words(t.endsWith("ies") ? `${t.slice(0, -3)}y` : t.replace(/s$/, ""));

// A truncated output is stored as a cut-off JSON string; it parses only when it was complete.
// Plain text (a model's reply) stays as it is.
function parsed(v: unknown): unknown {
  if (typeof v !== "string" || !/^\s*[[{]/.test(v)) return v;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Errors in plain words
// ---------------------------------------------------------------------------------------------

// Database and runtime internals never reach the trace sentence; the raw text stays under
// Technical details for the people who need it.
export function plainError(message: unknown): string {
  const m = typeof message === "string" ? message : message instanceof Error ? message.message : JSON.stringify(message ?? "");
  if (/D1_|D1 DB|SQLITE|no such (table|column)|constraint failed|syntax error|database is (locked|busy)|\bSQL\b/i.test(m)) return "a database error interrupted this step";
  if (/time ?out|timed out|aborted|deadline/i.test(m)) return "it took too long and was stopped";
  if (/\b429\b|rate.?limit|overloaded|too many requests|capacity/i.test(m)) return "the model service was busy";
  if (/fetch failed|ECONN|ENOTFOUND|network|socket/i.test(m)) return "the service couldn't be reached";
  if (/not found or outside your scope/i.test(m)) return "the record wasn't found or is outside your access";
  if (/TypeError|ReferenceError|SyntaxError|Cannot read propert|is not a function|undefined|\bat \S+ \(/.test(m)) return "something went wrong on our side";
  if (/ZodError|invalid_type|"path"|Expected .* received/i.test(m)) return "the model's reply wasn't in the expected format";
  const clean = m.trim().split("\n")[0];
  return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean || "something went wrong";
}

// ---------------------------------------------------------------------------------------------
// Which records a trace mentions
// ---------------------------------------------------------------------------------------------

// Record id → entity, from everything in the trace that names both (plan candidates carry the
// action, whose key starts with the entity). Lets "messages.draft { entity_id }" find its type.
export function recordIndex(steps: TraceStepLike[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const s of steps) {
    const out = obj(parsed(s.output));
    for (const c of Array.isArray(out?.candidates) ? out.candidates : []) {
      const o = obj(c);
      if (str(o?.record) && str(o?.action)) index.set(String(o!.record), String(o!.action).split(".")[0]);
    }
    const ref = refOf(s);
    if (ref) index.set(ref[1], ref[0]);
  }
  return index;
}

// The record a step's input names outright.
function refOf(s: TraceStepLike): [string, string] | null {
  const i = obj(s.input);
  if (!i) return null;
  if (s.toolKey === "ledger.lookup" && str(i.lease_id)) return ["leases", String(i.lease_id)];
  const entity = str(i.entity);
  const id = str(i.entity_id) ?? str(i.id);
  return entity && id ? [entity, id] : null;
}

export function wantedRefs(steps: TraceStepLike[]) {
  const index = recordIndex(steps);
  const records = new Map<string, [string, string]>();
  const entities = new Set<string>();
  const actions = new Set<string>();
  const proposals = new Set<string>();
  for (const [id, type] of index) records.set(`${type}:${id}`, [type, id]);
  for (const s of steps) {
    const i = obj(s.input);
    const out = obj(parsed(s.output));
    if (str(i?.entity_id) && index.has(String(i!.entity_id))) entities.add(index.get(String(i!.entity_id))!);
    if (str(i?.related)) entities.add(String(i!.related));
    for (const a of [i?.action, out?.action]) if (str(a)) actions.add(String(a));
    if (s.kind === "proposal" && str(out?.proposal_id) && !refOf(s)) proposals.add(String(out!.proposal_id));
    if (s.toolKey && !s.toolKey.startsWith("model.") && !KNOWN_TOOLS.has(s.toolKey)) entities.add(s.toolKey.split(".")[0]);
  }
  for (const [type] of records.values()) entities.add(type);
  for (const a of actions) entities.add(a.split(".")[0]);
  return { records: [...records.values()], entities: [...entities], actions: [...actions], proposals: [...proposals] };
}

// ---------------------------------------------------------------------------------------------
// Rows: tool calls paired with their results
// ---------------------------------------------------------------------------------------------

export function groupSteps(steps: TraceStepLike[], live = false): Omit<TraceRow, "sentence">[] {
  const used = new Set<number>();
  const rows: Omit<TraceRow, "sentence">[] = [];
  steps.forEach((s, i) => {
    if (used.has(i)) return;
    if (s.kind !== "tool_call" || !s.toolKey) {
      rows.push({ steps: [s], main: s, status: s.ok ? "done" : "failed" });
      return;
    }
    const r = steps.findIndex((x, j) => j > i && !used.has(j) && x.kind === "tool_result" && x.toolKey === s.toolKey);
    const group = [s];
    if (r > 0) {
      // The proposal an actions.propose call made sits between the call and its result.
      if (s.toolKey === "actions.propose") steps.slice(i + 1, r).forEach((x, k) => x.kind === "proposal" && (used.add(i + 1 + k), group.push(x)));
      used.add(r);
      group.push(steps[r]);
    }
    const proposal = group.find((x) => x.kind === "proposal");
    const result = r > 0 ? steps[r] : undefined;
    const status = group.some((x) => !x.ok) ? "failed" : result || proposal ? "done" : live ? "running" : "done";
    rows.push({ steps: group, main: proposal ?? s, status });
  });
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------------------------

type Ctx = { refs: TraceRefs; index: Map<string, string>; model?: string };

const manyLabel = (c: Ctx, entity: string) => (c.refs.entities[entity]?.many ?? words(entity)).toLowerCase();
const actionLabel = (c: Ctx, action: string) => c.refs.actions[action] ?? cap(words(action.split(".").slice(1).join(" ") || action));
const modelLabel = (c: Ctx, m?: unknown) => {
  const id = str(m) ?? c.model;
  return id && !/^rules/i.test(id) && id !== "…" ? modelName(id) : "The model";
};

// A record as sentence parts: its linked name and "(prospect at The Lofts)", or "a prospect" when
// the viewer can't see it. `shown` reports whether the name was shown.
function record(c: Ctx, entity: string | undefined, id: string | undefined): { parts: Part[]; shown: boolean } {
  if (!entity || !id) return { parts: [], shown: false };
  const r = c.refs.records[`${entity}:${id}`];
  const type = (r?.type ?? c.refs.entities[entity]?.one ?? singular(entity)).toLowerCase();
  if (!r?.name) return { parts: [`${article(type)} ${type}`], shown: false };
  const context = entity === "properties" ? "" : r.property ? ` (${type} at ${r.property})` : ` (${type})`;
  return { parts: [{ text: r.name, href: r.href }, ...(context ? [context] : [])], shown: true };
}
const recordById = (c: Ctx, id: unknown) => (str(id) ? record(c, c.index.get(String(id)), String(id)) : { parts: [], shown: false });

function proposalSentence(c: Ctx, rowSteps: TraceStepLike[], p: TraceStepLike): Sentence {
  const out = obj(parsed(p.output)) ?? {};
  const call = obj(rowSteps.find((s) => s.toolKey === "actions.propose")?.input);
  const title = str(out.title) ?? str(call?.title);
  if (out.duplicate) return { parts: [`Already waiting for approval${title ? `: ${title}` : ""}`] };
  const action = str(out.action) ?? str(obj(p.input)?.action) ?? str(call?.action);
  const key = (refOf(p) ?? (call ? refOf({ ...p, input: call }) : null))?.join(":") ?? c.refs.proposals[String(out.proposal_id)];
  const [entity, ...rest] = key ? key.split(":") : [];
  const rec = record(c, entity ?? action?.split(".")[0], rest.join(":") || undefined);
  const parts: Part[] = [action ? `Proposed “${actionLabel(c, action)}”` : "Proposed an action"];
  if (rec.parts.length) parts.push(" for ", ...rec.parts);
  // The title repeats the record's name; for a record the viewer can't see, leave it out.
  const reason = title && (rec.shown || !rec.parts.length) ? (/: (.+)$/.exec(title)?.[1] ?? / — (.+)$/.exec(title)?.[1] ?? (rec.parts.length ? undefined : title)) : undefined;
  if (reason) parts.push(`: ${reason}`);
  const conf = num(out.confidence);
  if (conf != null) parts.push(` · ${Math.round(conf * 100)}% confidence`);
  if (str(out.risk) && out.risk !== "Low") parts.push(` · ${String(out.risk).toLowerCase()} risk`);
  return { parts };
}

// A count of what a tool returned: a number field or the length of its list. Unknown for a result
// that was cut short.
function countOf(output: unknown): number | undefined {
  const o = parsed(output);
  if (Array.isArray(o)) return o.length;
  const r = obj(o);
  if (!r) return undefined;
  return num(r.total) ?? num(r.rows) ?? num(r.count) ?? (Array.isArray(r.rows) ? r.rows.length : Array.isArray(r.articles) ? r.articles.length : undefined);
}

type Verb = [past: string, ing: string, base: string];
const LOOK: Verb = ["Looked up", "Looking up", "look up"];
const READ: Verb = ["Read", "Reading", "read"];
const VERBS: Record<string, Verb> = {
  list: LOOK, get: LOOK, search: LOOK, lookup: LOOK, rank: ["Ranked", "Ranking", "rank"], check: ["Checked", "Checking", "check"],
  run: ["Ran", "Running", "run"], code: ["Coded", "Coding", "code"], extract: READ, read: READ, score: ["Scored", "Scoring", "score"],
  draft: ["Drafted", "Drafting", "draft"], create: ["Created", "Creating", "create"], propose: ["Proposed", "Proposing", "propose"],
};
type ToolText = { verb: Verb; what: Part[]; count?: number; countable?: boolean; tail?: Part[] };

const CHANNEL: Record<string, string> = { Email: "an email", SMS: "a text", Portal: "a portal message" };
const TOOLS: Record<string, (c: Ctx, i: Obj, out: unknown) => ToolText> = {
  "ledger.delinquency": (_c, i, out) => ({ verb: LOOK, what: ["residents who owe rent"], count: countOf(out), tail: num(i.min_days) ? [` (${i.min_days}+ days late)`] : [] }),
  "ledger.lookup": (c, i, out) => {
    const r = record(c, "leases", str(i.lease_id) ?? str(obj(obj(parsed(out))?.lease)?.id));
    return { verb: READ, what: r.parts.length ? ["the ledger for ", ...r.parts] : ["the payment history"] };
  },
  "records.get": (c, i) => {
    const r = record(c, str(i.entity), str(i.id));
    return { verb: READ, what: r.parts.length ? r.parts : ["the record's details"] };
  },
  "records.related": (c, i, out) => {
    const r = record(c, str(i.entity), str(i.id));
    return { verb: LOOK, what: [str(i.related) ? manyLabel(c, String(i.related)) : "related records", ...(r.parts.length ? [" for ", ...r.parts] : [])], count: countOf(out) };
  },
  "records.search": (c, i, out) => ({ verb: LOOK, what: [str(i.entity) ? manyLabel(c, String(i.entity)) : "records"], count: countOf(out) }),
  "metrics.monthly": () => ({ verb: LOOK, what: ["monthly property metrics"] }),
  "metrics.explain_noi": () => ({ verb: ["Broke down", "Breaking down", "break down"], what: ["the change in NOI"] }),
  "data.issues": (_c, i, out) => ({ verb: LOOK, what: [`${str(i.status) ?? "open"} data issues`], count: countOf(out) }),
  "help.search": (_c, i, out) => ({ verb: ["Searched", "Searching", "search"], what: [`help articles${str(i.query) ? ` for “${i.query}”` : ""}`], tail: countOf(out) != null ? [`: ${plural(countOf(out)!, "match", "matches")}`] : [] }),
  "policy.lookup": () => ({ verb: ["Checked", "Checking", "check"], what: ["approval policies and state rules"] }),
  "messages.draft": (c, i) => {
    const r = recordById(c, i.entity_id);
    return { verb: VERBS.draft, what: [CHANNEL[String(i.channel)] ?? "a message", ...(r.parts.length ? [" for ", ...r.parts] : [])], tail: str(i.subject) ? [`: “${i.subject}”`] : [] };
  },
  "actions.propose": (c, i) => ({ verb: ["Filed", "Filing", "file"], what: [`a proposal${str(i.title) ? `: ${i.title}` : ""}`] }),
  "data.propose_fix": (_c, i) => ({ verb: VERBS.propose, what: [`a fix for data issue ${str(i.issue_id) ?? ""}`.trim()] }),
  "documents.read": (_c, _i, out) => {
    const o = obj(parsed(out));
    return { verb: READ, what: [str(o?.document) ?? "the document"], tail: num(o?.pages) ? [` (${plural(Number(o!.pages), "page")})`] : [] };
  },
};
const KNOWN_TOOLS = new Set(Object.keys(TOOLS));
const MODEL_TASKS: Record<string, string> = { draft_reply: "draft a reply", abstract_lease: "abstract the lease", draft_announcement: "draft an announcement" };

function toolText(c: Ctx, key: string, input: unknown, output: unknown): ToolText {
  const i = obj(input) ?? {};
  if (TOOLS[key]) return TOOLS[key](c, i, output);
  if (key.startsWith("model.")) {
    const task = key.slice(6);
    return { verb: ["Asked", "Asking", "ask"], what: [`${modelLabel(c, i.model)} to ${MODEL_TASKS[task] ?? words(task)}`] };
  }
  // Tools named "<entity>.<verb>": "prospects.list" → "Looked up 14 prospects".
  const [entity, ...rest] = key.split(".");
  const verb = rest.join("_");
  const v = VERBS[verb.split("_")[0]];
  if (v === LOOK || (v && countOf(output) != null)) return { verb: v, what: [manyLabel(c, entity)], count: countOf(output), countable: true };
  return { verb: ["Ran", "Running", "run"], what: [`“${words(key)}”`] };
}

function toolSentence(c: Ctx, row: Omit<TraceRow, "sentence">): Sentence {
  const call = row.steps.find((s) => s.kind === "tool_call");
  const result = row.steps.find((s) => s.kind === "tool_result");
  const key = String(row.main.toolKey);
  const t = toolText(c, key, call?.input, result?.output);
  if (row.status === "failed") {
    const err = obj(parsed(result?.output))?.error ?? result?.output;
    const fallback = obj(parsed(result?.output))?.fallback ? "; the rules took over" : "";
    return { parts: [`Couldn't ${t.verb[2]} `, ...t.what, ...(t.tail ?? []), `: ${plainError(err)}${fallback}`] };
  }
  if (row.status === "running") return { parts: [`${t.verb[1]} `, ...t.what, ...(t.tail ?? []), "…"] };
  return { parts: [`${t.verb[0]} ${t.count != null ? `${t.count} ` : ""}`, ...t.what, ...(t.tail ?? [])] };
}

const TRIGGER: Record<string, string> = { manual: "Started by a person", schedule: "Started on schedule", event: "Started by an event", chat: "Started from the assistant", assistant: "Started from the assistant" };
const AUTONOMY: Record<string, string> = { suggest: "every action waits for approval", act_with_approval: "every action waits for approval", auto_within_policy: "low-risk actions within policy apply on their own" };
const STOPPED: Record<string, string> = { "time budget": "time limit reached" };

function planSentence(c: Ctx, out: unknown): Sentence | null {
  if (str(out)) return { parts: [String(out)] };
  const o = obj(out);
  if (!o) return null;
  if (str(o.plan)) return { parts: [String(o.plan)] };
  if (str(o.trigger)) {
    const m = str(o.model);
    return { parts: [`${TRIGGER[String(o.trigger)] ?? "Started"}${m ? `, using ${/^rules/i.test(m) ? "the rules (no model)" : modelName(m)}` : ""}${AUTONOMY[String(o.autonomy)] ? `; ${AUTONOMY[String(o.autonomy)]}` : ""}`] };
  }
  const found = num(o.found);
  if (found != null) {
    const considering = num(o.considering) ?? found;
    if (!found) return { parts: ["Found nothing to do"] };
    return { parts: [considering < found ? `Found ${plural(found, "candidate")}; reviewing the top ${considering}` : `Found ${plural(found, "candidate")} to review`] };
  }
  return null;
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

function reasoningSentence(c: Ctx, step: TraceStepLike, out: unknown): Sentence | null {
  if (str(out)) return { parts: [`${modelLabel(c)} explained its next step`], quote: String(out) };
  const o = obj(out);
  if (!o) return null;
  if (str(o.summary)) return { parts: [String(o.summary)] };
  const checks = obj(o.rule_checks);
  if (checks) {
    const vals = Object.values(checks);
    const issues = vals.reduce<number>((a, v) => a + (typeof v === "number" ? v : 0), 0);
    const failed = vals.filter((v) => typeof v !== "number").length;
    return { parts: [`Ran ${plural(vals.length, "data rule")}: ${plural(issues, "issue")} found${failed ? `, ${plural(failed, "rule")} couldn't run` : ""}`] };
  }
  if (num(o.score) != null) return { parts: [`Scored the application ${o.score}${str(o.recommendation) ? `: recommend ${String(o.recommendation).toLowerCase()}` : ""}`] };
  if (num(o.offer_rent_cents) != null) return { parts: [`Priced the renewal at ${money(Number(o.offer_rent_cents))}${num(o.change_pct) != null ? ` (${Number(o.change_pct) >= 0 ? "+" : ""}${o.change_pct}%)` : ""}`] };
  if (num(o.extracted) != null) {
    const mism = Array.isArray(o.mismatches) ? o.mismatches.length : 0;
    return { parts: [`Read ${plural(Number(o.extracted), "term")} from the document${mism ? `; ${plural(mism, "term doesn't", "terms don't")} match the record` : ""}`] };
  }
  if (o.rejected !== undefined) return { parts: [`Rejected the model's draft${Array.isArray(o.problems) && o.problems.length ? `: ${o.problems.map(String).join("; ")}` : ""}`] };
  return step.ok ? null : { parts: ["The reasoning step failed"] };
}

function messageSentence(c: Ctx, step: TraceStepLike, out: unknown): Sentence | null {
  if (str(out)) return { parts: [`${modelLabel(c)} replied`], quote: String(out) };
  const o = obj(out);
  if (!o) return null;
  if (o.auto_applied !== undefined) return { parts: [o.ok === false || !step.ok ? `Couldn't apply automatically: ${plainError(o.message ?? o.error)}` : `Applied automatically within policy${str(o.message) ? `: ${o.message}` : ""}`] };
  if (str(o.stopped)) return { parts: [`Stopped early: ${STOPPED[String(o.stopped)] ?? o.stopped}`] };
  if (o.model_error !== undefined) {
    const why = plainError(o.model_error);
    return { parts: [`${why === "something went wrong on our side" ? "The model call failed" : cap(why)}, so the ${str(o.fallback) === "template" ? "template" : "rules"} took over`] };
  }
  if (o.error !== undefined) return { parts: [`Stopped: ${plainError(o.error)}`] };
  if (o.refused !== undefined) return { parts: ["Declined to answer: the question touched on fair housing protected characteristics"] };
  if (Array.isArray(o.suggestions)) return { parts: [`Suggested ${plural(o.suggestions.length, "next step")}`] };
  if (o.rejected_answer !== undefined) return { parts: [`Rejected the model's answer${str(o.reason) ? `: ${o.reason}` : ""}`] };
  if (o.draft !== undefined) return { parts: [Array.isArray(o.rejected) && o.rejected.length ? `Rejected the model's draft (${o.rejected.map(String).join("; ")}); used the template` : "Drafted the message"] };
  if (o.rejected !== undefined) return { parts: [`Rejected the model's output${str(o.reason) ? `: ${o.reason}` : ""}`] };
  if (str(o.headline)) return { parts: [`Wrote the summary: “${o.headline}”`] };
  if (o.issue !== undefined) {
    const result = str(o.result) ?? "";
    if (o.applied) return { parts: [`Fixed the data issue${result ? `: ${result}` : ""}`] };
    if (o.queued) return { parts: [`Sent the data fix to approvals${result ? `: ${result}` : ""}`] };
    return { parts: [`Couldn't fix the data issue: ${plainError(result)}`] };
  }
  if (o.scored !== undefined) return { parts: [`Scored the application ${o.score ?? ""}${str(o.recommendation) ? `: recommend ${String(o.recommendation).toLowerCase()}` : ""}`.replace(/ :/, ":")] };
  if (str(o.looked_up)) return { parts: [`Looked up ${words(String(o.looked_up)).replace(/^\w+ /, "")} for ${plural(Number(o.properties ?? 0), "property", "properties")}${num(o.months) ? ` over ${plural(Number(o.months), "month")}` : ""}`] };
  return null;
}

const FALLBACK: Record<string, string> = { plan: "Planned the run", tool_call: "Called a tool", tool_result: "Got a tool result", reasoning_summary: "Reasoned about the next step", proposal: "Made a proposal", message: "Recorded a note" };

function sentenceFor(c: Ctx, row: Omit<TraceRow, "sentence">): Sentence {
  const s = row.main;
  if (s.summary) return { parts: [s.summary] };
  if (s.kind === "proposal") return proposalSentence(c, row.steps, s);
  if ((s.kind === "tool_call" || s.kind === "tool_result") && s.toolKey) return toolSentence(c, row);
  const out = parsed(s.output);
  const built = s.kind === "plan" ? planSentence(c, out) : s.kind === "reasoning_summary" ? reasoningSentence(c, s, out) : s.kind === "message" ? messageSentence(c, s, out) : null;
  if (built) return built;
  if (!s.ok) return { parts: [`Hit a problem${obj(out)?.error !== undefined ? `: ${plainError(obj(out)!.error)}` : ""}`] };
  return { parts: [FALLBACK[s.kind] ?? "Did a step"] };
}

export function describeSteps(steps: TraceStepLike[], refs: TraceRefs = NO_REFS, opts: { model?: string; live?: boolean; index?: Map<string, string> } = {}): TraceRow[] {
  const index = opts.index ?? recordIndex(steps);
  // The model named in the run's opening step, while the run row doesn't have it yet.
  const planModel = steps.map((s) => str(obj(parsed(s.output))?.model)).find(Boolean);
  const c: Ctx = { refs, index, model: opts.model && opts.model !== "…" ? opts.model : planModel };
  return groupSteps(steps, opts.live).map((row) => ({ ...row, sentence: sentenceFor(c, row) }));
}

export const sentenceText = (s: Sentence) => s.parts.map((p) => (typeof p === "string" ? p : p.text)).join("");
