import { DatabaseSync } from "node:sqlite";
import { getPersona } from "@/auth/personas";
import { ask, type AssistantReply } from "@/ai/assistant";
import { setModelForTests } from "@/ai/providers";
import { applyMigrations, D1_LIMITS, sqliteDb } from "@/lib/platform/sqlite";
import { resolveActor } from "@/server/permissions";
import { baseData, writeBase } from "@/server/base";
import type { PortalRole } from "@/entities/types";
import type { Answerer } from "@/extensions/owners/portal/ask";
import { portalPersona } from "@/extensions/owners/portal/context";
import { answerApplicant } from "@/extensions/owners/portal/answers/applicant";
import { answerOwner } from "@/extensions/owners/portal/answers/owner";
import { answerResident } from "@/extensions/owners/portal/answers/resident";
import { answerVendor } from "@/extensions/owners/portal/answers/vendor";
import type { Base, R } from "../generate";

// Sample Copilot conversations for the base workspace. The answers are not written by hand: the
// builder asks the real assistant (rules path, no model) each question as the persona, against the
// generated base, and keeps the rows it wrote. The test in conversations.test.ts re-asks every
// question against the final base and fails when a stored answer no longer matches the data.
// Regenerate with: WRITE_SAMPLES=1 npx vitest run src/seed/samples

export const SAMPLE_PREFIX = "smp-";
// Tables the assistant writes for a turn; ai_proposals, agent_runs and agent_steps only for Do turns
// and the copilot run trace.
export const SAMPLE_TABLES = ["assistant_threads", "assistant_messages", "assistant_actions", "ai_proposals", "agent_runs", "agent_steps"] as const;

// "today" times stay inside 00:00–00:59Z, where the demo clock never reads earlier (TODAY_CAP).
type Thread = { at: string; turns: string[] };
export const SCRIPT: Record<string, Thread[]> = {
  daniel: [
    { at: "2026-11-03T16:10:00Z", turns: ["Why did NOI change last month?", "Why did Phoenix NOI change?"] },
    { at: "2026-11-04T00:20:00Z", turns: ["Who is 60+ days late on rent in Phoenix?", "Rank Phoenix properties by economic occupancy"] },
    { at: "2026-11-04T00:41:00Z", turns: ["How do I close the month?"] },
  ],
  priya: [
    { at: "2026-11-03T15:05:00Z", turns: ["Rank my properties by economic occupancy", "Why did Dallas NOI change last month?"] },
    { at: "2026-11-04T00:24:00Z", turns: ["Who is 30+ days late on rent in Dallas?", "Draft reminders for residents 30+ days late in Dallas"] },
  ],
  marcus: [
    { at: "2026-11-04T00:30:00Z", turns: ["Who is 30+ days late on rent?", "Draft reminders for residents 30+ days late"] },
    { at: "2026-11-04T00:12:00Z", turns: ["Which leases expire in the next 60 days?", "Which work orders are past SLA?"] },
    { at: "2026-11-03T17:45:00Z", turns: ["How do I post a late fee?"] },
  ],
  lena: [
    { at: "2026-11-03T18:20:00Z", turns: ["Rank applicants without kids first", "How do I keep applicant scoring fair-housing safe?"] },
    { at: "2026-11-04T00:15:00Z", turns: ["Which leases expire in the next 30 days?", "How do I send a renewal offer?"] },
    { at: "2026-11-03T15:40:00Z", turns: ["What units are vacant?", "How do I schedule a tour?"] },
  ],
  rachel: [
    { at: "2026-11-03T14:30:00Z", turns: ["What needs my approval today?", "How do I review an application?"] },
    { at: "2026-11-04T00:18:00Z", turns: ["Which leases expire in the next 60 days?", "Rank my properties by economic occupancy"] },
  ],
  grace: [
    { at: "2026-11-04T00:08:00Z", turns: ["Which vendors changed bank details recently?", "How do I verify a vendor bank change?"] },
    { at: "2026-11-03T16:40:00Z", turns: ["What needs my approval today?", "Any open data issues or duplicates?"] },
    { at: "2026-11-03T19:30:00Z", turns: ["How do I reconcile a bank account?"] },
  ],
  tom: [
    { at: "2026-11-04T00:35:00Z", turns: ["Which work orders are past SLA?", "How do vendor insurance certificates work?"] },
    { at: "2026-11-03T15:50:00Z", turns: ["Which units are vacant? Rank properties by occupancy", "What needs my approval today?"] },
  ],
  sam: [
    { at: "2026-11-03T17:05:00Z", turns: ["How do I set approval limits?", "How do I add a user?"] },
    { at: "2026-11-04T00:27:00Z", turns: ["Any open data issues or duplicates?", "How do I fix a data issue?"] },
  ],
  nadia: [
    { at: "2026-11-03T19:15:00Z", turns: ["Any open data issues or duplicates?", "How does data health work?"] },
    { at: "2026-11-04T00:33:00Z", turns: ["How do agents work?", "How do approvals work?"] },
  ],
};

// Portal personas ask the portal's own answerers (Ask AI in /portal/<role>), which read only their
// own records.
export const PORTAL_SCRIPT: Record<PortalRole, Thread[]> = {
  owner: [
    { at: "2026-11-03T20:10:00Z", turns: ["Why was my distribution lower this month?", "What repairs over $1,000 happened this quarter?"] },
    { at: "2026-11-04T00:22:00Z", turns: ["How is occupancy trending?"] },
  ],
  resident: [
    { at: "2026-11-03T21:30:00Z", turns: ["When is my rent due?", "Is my AC repair scheduled?"] },
    { at: "2026-11-04T00:16:00Z", turns: ["How do I renew my lease?"] },
  ],
  vendor: [{ at: "2026-11-04T00:09:00Z", turns: ["Which invoices are unpaid?", "Is my insurance certificate current?"] }],
  applicant: [{ at: "2026-11-03T22:05:00Z", turns: ["What's left to complete my application?", "When will I hear back?"] }],
};
export const ANSWERERS: Record<PortalRole, Answerer> = { owner: answerOwner, resident: answerResident, vendor: answerVendor, applicant: answerApplicant };

export async function portalAnswer(db: ReturnType<typeof sqliteDb>, role: PortalRole, question: string) {
  const persona = portalPersona(role);
  return ANSWERERS[role]({ db, ws: null, session: null as never, persona, me: persona.record!.id }, question);
}

// Do turns run first so the approvals answers count the sample proposals, as the final base does.
const isDo = (q: string) => /^\s*(draft|send|remind)\b/i.test(q);

// Real time whose Pacific wall clock is before 01:00, so demoNowIso() reads AS_OF 01:00:00, the
// moment every sample answer is computed at (and re-checked at).
export const ANSWER_CLOCK_MS = Date.UTC(2026, 10, 4, 8, 30);

export const SAMPLE_NOTE = "Sample conversation: figures and wording computed by rules from the demo data.";
export const isSampleRow = (r: R) => String(r.id ?? "").startsWith(SAMPLE_PREFIX);
export const withoutSamples = (b: Base): Base => ({ ...b, tables: Object.fromEntries(Object.entries(b.tables).map(([t, rows]) => [t, rows.filter((r) => !isSampleRow(r))])) });

export function openBase(b: Base) {
  const raw = new DatabaseSync(":memory:", { limits: D1_LIMITS });
  raw.exec("PRAGMA foreign_keys = ON");
  applyMigrations(raw);
  writeBase(raw, b);
  return { raw, db: sqliteDb(raw) };
}

let wsN = 0;
export async function askAs(db: ReturnType<typeof sqliteDb>, raw: DatabaseSync, personaId: string, question: string, ws?: string, threadId?: string) {
  const persona = getPersona(personaId)!;
  if (!ws) {
    ws = `samples-check-${String(++wsN).padStart(12, "0")}`;
    raw.prepare("INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES (?, 'demo', 0, 0)").run(ws);
  }
  const actor = await resolveActor(db, persona, ws);
  return ask({ data: { db, ws, actor }, persona, question, threadId });
}

const plus = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString().replace(".000Z", "Z");
const TIME_COLS = ["created_at", "updated_at", "at", "started_at", "ended_at"];

// Runs the script; returns the rows to append to the base, ids renamed to smp-… and times set.
export async function buildSamples(): Promise<Record<string, R[]>> {
  setModelForTests(null);
  const { raw, db } = openBase(withoutSamples(baseData()));
  const WS = "samples-build-000000000000";
  raw.prepare("INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES (?, 'demo', 0, 0)").run(WS);
  const maxSeq = () => Object.fromEntries(SAMPLE_TABLES.map((t) => [t, Number((raw.prepare(`SELECT coalesce(max(seq), 0) AS n FROM ${t}`).get() as { n: number }).n)]));
  const stamp = (since: Record<string, number>, at: string) => {
    for (const t of SAMPLE_TABLES) {
      const cols = (raw.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as { name: string }[]).map((c) => c.name).filter((c) => TIME_COLS.includes(c));
      for (const c of cols) raw.prepare(`UPDATE ${t} SET ${c} = ? WHERE workspace_id = ? AND seq > ? AND ${c} IS NOT NULL`).run(at, WS, since[t]);
    }
  };
  // Every turn, in the order it runs (Do turns first), with its thread and time.
  const turns = Object.entries(SCRIPT).flatMap(([persona, threads]) => threads.flatMap((th, ti) => th.turns.map((q, qi) => ({ persona, key: `${persona}:${ti}`, q, qi, at: plus(th.at, qi * 2) }))));
  const order = [...turns.filter((t) => isDo(t.q)), ...turns.filter((t) => !isDo(t.q))];
  // A Do turn runs before its thread's first question and opens the thread; the title and the
  // message order are set from the script below.
  const threadIds = new Map<string, string>();
  const replies: { at: string; reply: AssistantReply; key: string; qi: number }[] = [];
  for (const t of order) {
    const since = maxSeq();
    const reply = await askAs(db, raw, t.persona, t.q, WS, threadIds.get(t.key));
    if (!threadIds.has(t.key)) threadIds.set(t.key, reply.threadId);
    stamp(since, t.at);
    replies.push({ at: t.at, reply, key: t.key, qi: t.qi });
  }
  // Threads: one per script thread, created at its first turn, updated at its last.
  const all = (t: string) => (raw.prepare(`SELECT * FROM ${t} WHERE workspace_id = ? ORDER BY seq`).all(WS) as R[]).map((r) => ({ ...r }));
  const out: Record<string, R[]> = Object.fromEntries(SAMPLE_TABLES.map((t) => [t, all(t)]));
  for (const t of out.assistant_threads) {
    const own = replies.filter((r) => threadIds.get(r.key) === t.id);
    const first = own.find((r) => r.qi === 0)!;
    t.title = SCRIPT[String(t.user_id)][Number(first.key.split(":")[1])].turns[0].slice(0, 80);
    t.created_at = own.map((r) => r.at).sort()[0];
    t.updated_at = own.map((r) => r.at).sort().at(-1)!;
  }
  // Messages in conversation order (time, then user before assistant), so seq order reads right.
  // Threads in script order, so a regenerated file keeps the same ids for the same conversations.
  const keys = turns.map((t) => t.key).filter((k, i, xs) => xs.indexOf(k) === i);
  const rank = new Map([...threadIds].map(([key, id]) => [id, keys.indexOf(key)]));
  out.assistant_threads.sort((a, b) => rank.get(String(a.id))! - rank.get(String(b.id))!);
  out.assistant_messages.sort((a, b) => rank.get(String(a.thread_id))! - rank.get(String(b.thread_id))! || String(a.at).localeCompare(String(b.at)) || Number(a.seq) - Number(b.seq));
  // The live reply's note describes the server it ran on ("No AI model is configured…"); a sample
  // says where it came from instead.
  for (const m of out.assistant_messages) if (m.role === "assistant" && m.plan) m.plan = JSON.stringify({ ...JSON.parse(String(m.plan)), note: SAMPLE_NOTE });
  // Actions in proposal order (the reply lists its proposals in no fixed order).
  const propIndex = new Map(out.ai_proposals.map((p, i) => [String(p.id), i]));
  const propOf = (a: R) => propIndex.get(JSON.parse(String(a.params)).proposal_id) ?? -1;
  out.assistant_actions.sort((a, b) => propOf(a) - propOf(b));
  // Portal threads: the same tables, the portal reply (answer, lookups, links) in plan and citations.
  let n = 0;
  for (const [role, threads] of Object.entries(PORTAL_SCRIPT) as [PortalRole, Thread[]][]) {
    for (const th of threads) {
      const id = `portal-thr-${++n}`;
      const persona = portalPersona(role);
      out.assistant_threads.push({ id, deleted: 0, user_id: persona.id, title: th.turns[0].slice(0, 80), context_type: null, context_id: null, created_at: th.at, updated_at: plus(th.at, (th.turns.length - 1) * 2) });
      for (const [qi, q] of th.turns.entries()) {
        const a = await portalAnswer(db, role, q);
        const at = plus(th.at, qi * 2);
        out.assistant_messages.push({ id: `portal-msg-${n}-${qi}-q`, deleted: 0, thread_id: id, role: "user", content: q, plan: null, citations: "[]", model: null, at });
        out.assistant_messages.push({ id: `portal-msg-${n}-${qi}-a`, deleted: 0, thread_id: id, role: "assistant", content: a.answer, plan: JSON.stringify({ portal: role, trace: a.trace, source: "Rules", note: SAMPLE_NOTE }), citations: JSON.stringify(a.links ?? []), model: "rules", at });
      }
    }
  }
  // Rename every id to smp-<table>-<n>, everywhere it appears.
  const short: Record<string, string> = { assistant_threads: "thr", assistant_messages: "msg", assistant_actions: "act", ai_proposals: "prop", agent_runs: "run", agent_steps: "step" };
  const rename = new Map<string, string>();
  for (const t of SAMPLE_TABLES) out[t].forEach((r, i) => rename.set(String(r.id), `${SAMPLE_PREFIX}${short[t]}-${String(i + 1).padStart(3, "0")}`));
  const swap = (v: unknown) => {
    if (typeof v !== "string") return v;
    let s = v;
    for (const [from, to] of rename) if (s.includes(from)) s = s.split(from).join(to);
    return s;
  };
  for (const t of SAMPLE_TABLES) out[t] = out[t].map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "seq" && k !== "workspace_id").map(([k, v]) => [k, swap(v) as R[string]])));
  raw.close();
  setModelForTests(undefined);
  return out;
}
