import { beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatform } from "@/lib/platform";
import { getPersona } from "@/auth/personas";
import { actorFor } from "@/server/permissions";
import { seed, WS } from "@/server/query.fixture";
import { inputSchema, resolveAction, runAction as run } from "@/app/api/e/_lib/actions";
import type { ActionDef } from "@/entities/types";
import { getDef, QueryError } from "@/server/query";
import { setModelForTests } from "@/ai/providers";

import "@/entities";

// Leasing friction fixes: one-click and bulk follow-ups, AI-drafted follow-ups, prepared renewal
// offers, reassigning stale leads. Rules only (no model): every figure comes from the records.
vi.mock("@/lib/platform", async () => {
  const db = (await import("@/server/query.fixture")).emptyDb();
  return { getPlatform: () => ({ db }) };
});

const runAction = (ctx: Parameters<typeof run>[0], a: ActionDef, id: string, body: unknown) => run(ctx, a, id, inputSchema(a).parse(body));
const ctxFor = async (persona: string) => {
  const db = getPlatform().db;
  return { db, ws: WS, actor: await actorFor(db, WS, getPersona(persona)!), nowMs: Date.parse("2026-11-04T15:00:00Z") };
};
const count = async (sql: string, ...binds: unknown[]) => Number((await getPlatform().db.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0);
// The bulk route runs each id through runAction and turns a QueryError into that id's status.
const bulk = async (ctx: Parameters<typeof run>[0], a: ActionDef, ids: string[], input: unknown = {}) => {
  const out: number[] = [];
  for (const id of ids) {
    try {
      out.push((await runAction(ctx, a, id, input)).status);
    } catch (e) {
      if (!(e instanceof QueryError)) throw e;
      out.push(e.status);
    }
  }
  return out;
};

beforeAll(async () => {
  setModelForTests(null);
  const db = getPlatform().db;
  await seed(db);
  const rows = [
    "INSERT INTO prospects (workspace_id, id, property_id, name, stage, created_at, last_contact_at, assigned_to) VALUES ('base', 'pr-a', 'p01', 'Maya Chen', 'Contacted', '2026-10-20T15:00:00Z', '2026-10-25T15:00:00Z', 's-old')",
    "INSERT INTO prospects (workspace_id, id, property_id, name, stage, created_at, last_contact_at, assigned_to) VALUES ('base', 'pr-b', 'p02', 'Omar Haddad', 'Toured', '2026-10-18T15:00:00Z', '2026-10-24T15:00:00Z', 's-old')",
    "INSERT INTO prospects (workspace_id, id, property_id, name, stage, created_at, last_contact_at, assigned_to) VALUES ('base', 'pr-out', 'p06', 'Far Lead', 'Contacted', '2026-10-18T15:00:00Z', '2026-10-24T15:00:00Z', 's-old')",
    "INSERT INTO prospects (workspace_id, id, property_id, name, stage, created_at, budget_cents, desired_beds) VALUES ('base', 'pr-c', 'p01', 'Lee Park', 'Inquiry', '2026-10-28T15:00:00Z', 180000, 2)",
  ];
  for (const r of rows) await db.prepare(r).run();
});

describe("follow-ups", () => {
  it("offers a one-click Send follow-up on the record, the drawer and the list's bulk bar", () => {
    const a = resolveAction("prospects", "follow_up");
    expect(a).toMatchObject({ label: "Send follow-up", bulk: true });
    // No input form: the record header and the drawer only show actions without one.
    expect(a.input).toBeUndefined();
    expect(a.confirm?.title).toBeTruthy();
    const def = getDef("prospects");
    expect(def.actions).toContain("prospects.follow_up");
    expect(def.list.bulkActions).toContain("prospects.follow_up");
  });

  it("sends once per lead per day, even on a double click, and logs the contact", async () => {
    const ctx = await ctxFor("lena");
    const a = resolveAction("prospects", "follow_up");
    const results = await Promise.all([runAction(ctx, a, "pr-a", {}), runAction(ctx, a, "pr-a", {})]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await count("SELECT count(*) AS n FROM messages m JOIN message_threads t ON t.id = m.thread_id AND t.workspace_id = m.workspace_id WHERE m.workspace_id = ? AND t.party_id = 'pr-a'", WS)).toBe(1);
    expect(await count("SELECT count(*) AS n FROM audit WHERE workspace_id = ? AND entity_id = 'pr-a' AND action = 'prospects.follow_up'", WS)).toBe(1);
    // The edited send (from the draft panel or an approved proposal) is the same follow-up for the day.
    const again = await runAction(ctx, resolveAction("prospects", "send_follow_up"), "pr-a", { subject: "Checking in", body: "Hi Maya, are you still looking? Reply with a time to tour." });
    expect(again.status).toBe(409);
  });

  it("bulk sends only to leads in the person's scope", async () => {
    const ctx = await ctxFor("lena");
    expect(await bulk(ctx, resolveAction("prospects", "follow_up"), ["pr-b", "pr-out"])).toEqual([200, 404]);
    expect(await count("SELECT count(*) AS n FROM message_threads WHERE workspace_id = ? AND party_id = 'pr-out'", WS)).toBe(0);
  });

  it("sends a person's edited draft and refuses fair-housing wording", async () => {
    const ctx = await ctxFor("lena");
    const send = resolveAction("prospects", "send_follow_up");
    const bad = await runAction(ctx, send, "pr-c", { subject: "Checking in", body: "Hi Lee, a quiet building, perfect for a young couple with no kids." });
    expect(bad.status).toBe(409);
    const good = await runAction(ctx, send, "pr-c", { subject: "Checking in", body: "Hi Lee, are you still looking? Reply with a time to tour." });
    expect(good.status).toBe(200);
    const msg = await getPlatform().db.prepare("SELECT m.body FROM messages m JOIN message_threads t ON t.id = m.thread_id AND t.workspace_id = m.workspace_id WHERE m.workspace_id = ? AND t.party_id = 'pr-c'").bind(WS).first<{ body: string }>();
    expect(msg?.body).toMatch(/^Hi Lee, are you still looking/);
  });

  it("drafts a follow-up from the lead's facts for a person to edit, and sends nothing", async () => {
    const ctx = await ctxFor("lena");
    await getPlatform().db.prepare("INSERT INTO prospects (workspace_id, id, property_id, name, stage, created_at, budget_cents, desired_beds) VALUES ('base', 'pr-d', 'p03', 'Sam Ortiz', 'Inquiry', '2026-10-28T15:00:00Z', 160000, 1)").run();
    const before = await count("SELECT count(*) AS n FROM messages WHERE workspace_id = ?", WS);
    const r = await runAction(ctx, resolveAction("prospects", "draft_follow_up"), "pr-d", {});
    if (r.status !== 200) throw new Error(`draft failed: ${JSON.stringify(r)}`);
    const d = JSON.parse(String(r.message)) as { subject: string; body: string; runId: string; source: string };
    expect(d.body).toMatch(/^Hi Sam/);
    expect(d.body).toContain("Lena Ortiz");
    expect(d.source).toBe("rules");
    expect(r.href).toBe(`/app/ai/runs/${d.runId}`);
    expect(await count("SELECT count(*) AS n FROM messages WHERE workspace_id = ?", WS)).toBe(before);
  });
});
