import "@/entities";
import "@/ai/actions";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPersona, inLakeside, PERSONAS } from "@/auth/personas";
import { ask, threadMessages, threads as listThreads, unverified } from "@/ai/assistant";
import { staffDecision } from "@/ai/decide";
import { Payload } from "@/ai/effects";
import { setModelForTests } from "@/ai/providers";
import { allTools } from "@/ai/tools/registry";
import { checkFairHousing, screensByProtectedClass } from "@/extensions/leasing/fairHousing";
import { getAction } from "@/extensions/actions";
import { resolveActor } from "@/server/permissions";
import { baseData } from "@/server/base";
import type { R } from "../generate";
import { ANSWER_CLOCK_MS, askAs, buildSamples, isSampleRow, openBase, PORTAL_SCRIPT, portalAnswer, SAMPLE_TABLES, SCRIPT } from "./build";

// The seeded sample conversations must be what the assistant says about the base today: every
// question is asked again against the final base, at the same demo moment, and must get the same
// answer. Regenerate after a data change with WRITE_SAMPLES=1 npx vitest run src/seed/samples.

const write = !!process.env.WRITE_SAMPLES;
const FILE = fileURLToPath(new URL("./conversations.json", import.meta.url));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(ANSWER_CLOCK_MS);
  setModelForTests(null);
});
afterAll(() => {
  vi.useRealTimers();
  setModelForTests(undefined);
});

describe.runIf(write)("write the sample conversations", () => {
  it("asks every question and writes conversations.json", async () => {
    const out = await buildSamples();
    // One row per line, so a regenerated file diffs by row.
    const body = Object.entries(out).map(([t, rows]) => `  ${JSON.stringify(t)}: [\n${rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n")}\n  ]`).join(",\n");
    writeFileSync(FILE, `{\n${body}\n}\n`);
  }, 600_000);
});

describe.skipIf(write)("sample conversations", { timeout: 600_000 }, () => {
  const T = baseData().tables;
  const sample = (t: string) => (T[t] ?? []).filter(isSampleRow);
  const threads = sample("assistant_threads");
  const messages = sample("assistant_messages");
  const ownerOf = (threadId: unknown) => String(threads.find((t) => t.id === threadId)?.user_id);
  const turns = (threadId: unknown) => messages.filter((m) => m.thread_id === threadId);

  it("gives every staff persona at least two threads and every portal persona at least one", () => {
    for (const p of PERSONAS) {
      const n = threads.filter((t) => t.user_id === p.id).length;
      // Lakeside, the empty demo org, starts with no conversations (and can't see Summit's).
      if (inLakeside(p)) {
        expect(n, p.id).toBe(0);
        continue;
      }
      expect(n, p.id).toBeGreaterThanOrEqual(p.portal ? 1 : 2);
      expect(n, p.id).toBe(p.portal ? PORTAL_SCRIPT[p.role as keyof typeof PORTAL_SCRIPT].length : SCRIPT[p.id].length);
    }
    for (const t of threads) {
      const ms = turns(t.id);
      expect(ms.length, String(t.title)).toBeGreaterThanOrEqual(2);
      expect(ms.map((m) => m.role).join(","), String(t.title)).toMatch(/^(user,assistant,?)+$/);
      expect(t.title).toBe(String(ms[0].content).slice(0, 80));
      // Yesterday or today on the demo clock, never later than the end of the seeded today.
      expect(String(t.updated_at) >= "2026-11-03" && String(t.updated_at) <= "2026-11-04T00:59:59Z", String(t.title)).toBe(true);
    }
  });

  it("only seeds the assistant's own tables, with no decisions or sent messages", () => {
    for (const [t, rows] of Object.entries(T)) if (!(SAMPLE_TABLES as readonly string[]).includes(t)) expect(rows.filter(isSampleRow), t).toEqual([]);
    const ids = new Set(sample("ai_proposals").map((p) => p.id));
    expect((T.ai_decisions ?? []).filter((d) => ids.has(d.proposal_id))).toEqual([]);
  });

  it("re-asks every staff question against the final base and gets the same answer, with every figure in the looked-up data", async () => {
    const { raw, db } = openBase(baseData());
    // Full tool results (the stored trace is cut at 6,000 characters), as ask() checks a model answer.
    let outputs: string[] = [];
    for (const t of allTools()) {
      const run = t.run;
      t.run = async (...args: Parameters<typeof run>) => {
        const out = await run(...args);
        outputs.push(JSON.stringify(out));
        return out;
      };
    }
    let checked = 0;
    for (const t of threads.filter((x) => !getPersona(String(x.user_id))!.portal)) {
      const ms = turns(t.id);
      for (let i = 0; i < ms.length; i += 2) {
        const q = String(ms[i].content), stored = ms[i + 1];
        outputs = [];
        const r = await askAs(db, raw, String(t.user_id), q);
        expect(r.answer, `${t.user_id}: ${q}`).toBe(stored.content);
        expect(r.citations, q).toEqual(JSON.parse(String(stored.citations)));
        expect(r.table, q).toEqual(JSON.parse(String(stored.plan)).table);
        expect(unverified(String(stored.content), outputs), q).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("shows each persona only their own sample threads", async () => {
    const { raw, db } = openBase(baseData());
    raw.prepare("INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES ('samples-scope-000000000001', 'demo', 0, 0)").run();
    const marcus = getPersona("marcus")!;
    const data = { db, ws: "samples-scope-000000000001", actor: await resolveActor(db, marcus, "samples-scope-000000000001") };
    const own = (id: string) => threads.filter((t) => t.user_id === id).map((t) => String(t.id)).sort();
    for (const ws of ["base", data.ws]) expect((await listThreads({ ...data, ws }, "marcus", 30)).map((t) => t.id).sort()).toEqual(own("marcus"));
    for (const id of own("daniel")) expect(await threadMessages(data, "marcus", id), id).toBeNull();
    expect(await threadMessages(data, "marcus", own("marcus")[0])).not.toBeNull();
    // Asking as Marcus with Daniel's thread id starts a new thread of Marcus's; Daniel's is untouched.
    const r = await ask({ data, persona: marcus, question: "How do I post a late fee?", threadId: own("daniel")[0] });
    expect(r.threadId).not.toBe(own("daniel")[0]);
    expect((await threadMessages({ ...data, actor: await resolveActor(db, getPersona("daniel")!, data.ws) }, "daniel", own("daniel")[0]))!.turns).toHaveLength(turns(own("daniel")[0]).length);
  });

  it("re-asks every portal question and gets the same answer", async () => {
    const { db } = openBase(baseData());
    for (const t of threads.filter((x) => getPersona(String(x.user_id))!.portal)) {
      const ms = turns(t.id);
      for (let i = 0; i < ms.length; i += 2) {
        const a = await portalAnswer(db, getPersona(String(t.user_id))!.role as keyof typeof PORTAL_SCRIPT, String(ms[i].content));
        expect(a.answer, String(ms[i].content)).toBe(ms[i + 1].content);
        expect(a.links ?? []).toEqual(JSON.parse(String(ms[i + 1].citations)));
      }
    }
  });

  it("never uses protected characteristics, and refuses the one screening request", () => {
    for (const m of messages.filter((x) => x.role === "assistant")) {
      expect(screensByProtectedClass(String(m.content)), String(m.content)).toEqual([]);
      expect(checkFairHousing(String(m.content)), String(m.content)).toEqual([]);
    }
    const asked = messages.filter((m) => m.role === "user" && screensByProtectedClass(String(m.content)).length);
    expect(asked.map((m) => ownerOf(m.thread_id))).toEqual(["lena"]);
    const reply = messages[messages.indexOf(asked[0]) + 1];
    expect(String(reply.content)).toMatch(/^I can't help choose or screen people/);
  });

  it("keeps Do actions as pending proposals the persona may decide, inside their scope", async () => {
    const { db } = openBase(baseData());
    const proposals = sample("ai_proposals");
    const actions = sample("assistant_actions");
    expect(proposals.length).toBeGreaterThan(0);
    expect(actions.length).toBe(proposals.length);
    for (const a of actions) {
      const p = proposals.find((x) => x.id === JSON.parse(String(a.params)).proposal_id) as R;
      expect(p, String(a.id)).toBeTruthy();
      expect(a.status).toBe("Proposed");
      const persona = getPersona(ownerOf(messages.find((m) => m.id === a.message_id)?.thread_id))!;
      const actor = await resolveActor(db, persona);
      expect(p.queue_state).toBe("needs_you");
      expect(getAction(String(p.action) as never), String(p.action)).toBeTruthy();
      expect(Payload.safeParse(JSON.parse(String(p.payload))).success).toBe(true);
      expect(staffDecision(persona.role, p), `${persona.id} ${p.title}`).toEqual({ ok: true });
      if (actor.propertyIds !== "all") expect(actor.propertyIds, `${persona.id} ${p.title}`).toContain(p.property_id);
      expect(sample("agent_runs").some((r) => r.id === p.run_id) && sample("agent_steps").some((s) => s.id === p.step_id), String(p.id)).toBe(true);
    }
  });
});
