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

describe("prepare all renewal drafts", () => {
  beforeAll(async () => {
    const db = getPlatform().db;
    for (const [id, lease, prop] of [["ro-p1", "l-p01-u1", "p01"], ["ro-p2", "l-p01-u2", "p01"], ["ro-far", "l-p06-u1", "p06"]]) {
      await db.prepare("INSERT INTO renewal_offers (workspace_id, id, lease_id, property_id, version, term_months, rent_cents, current_rent_cents, status) VALUES ('base', ?, ?, ?, 1, 12, 145000, 145000, 'Draft')").bind(id, lease, prop).run();
    }
  });
  const openProposals = (id: string) => getPlatform().db.prepare("SELECT p.* FROM ai_proposals p WHERE p.workspace_id = ? AND p.entity_id = ? AND p.action = 'renewal_offers.send' AND NOT EXISTS (SELECT 1 FROM ai_decisions d WHERE d.workspace_id = p.workspace_id AND d.proposal_id = p.id)").bind(WS, id).all<Record<string, unknown>>();

  it("prices the draft and drafts its message as one proposal for a person, sending nothing", async () => {
    const ctx = await ctxFor("lena");
    const r = await runAction(ctx, resolveAction("renewal_offers", "prepare"), "ro-p1", {});
    if (r.status !== 200) throw new Error(JSON.stringify(r));
    const out = JSON.parse(String(r.message)) as { rentCents: number; subject: string; body: string; proposalId: string; risk: string };
    const offer = await getPlatform().db.prepare("SELECT status, rent_cents FROM renewal_offers WHERE workspace_id = ? AND id = 'ro-p1'").bind(WS).first<{ status: string; rent_cents: number }>();
    expect(offer).toEqual({ status: "Draft", rent_cents: out.rentCents });
    const [p] = (await openProposals("ro-p1")).results;
    expect(p.id).toBe(out.proposalId);
    const payload = JSON.parse(String(p.payload));
    expect(payload).toMatchObject({ subject: out.subject, body: out.body, ai_drafted: true });
    expect(out.body).toContain(`$${(out.rentCents / 100).toLocaleString("en-US")}`);
    expect(await count("SELECT count(*) AS n FROM messages WHERE workspace_id = ? AND body = ?", WS, out.body)).toBe(0);
  });

  it("is idempotent: preparing again keeps the one proposal", async () => {
    const ctx = await ctxFor("lena");
    const r = await runAction(ctx, resolveAction("renewal_offers", "prepare"), "ro-p1", {});
    expect(r.status).toBe(200);
    expect((await openProposals("ro-p1")).results).toHaveLength(1);
  });

  it("runs in bulk only on drafts in scope", async () => {
    const ctx = await ctxFor("lena");
    expect(await bulk(ctx, resolveAction("renewal_offers", "prepare"), ["ro-p2", "ro-far"])).toEqual([200, 404]);
    expect((await openProposals("ro-far")).results).toHaveLength(0);
  });

  it("approving a prepared proposal sends the drafted message at the proposed rent", async () => {
    const { executeProposal } = await import("@/ai/effects");
    const ctx = await ctxFor("lena");
    const [p] = (await openProposals("ro-p2")).results;
    const r = await executeProposal({ db: ctx.db, ws: WS, actor: ctx.actor }, p, { id: "lena", name: "Lena Ortiz", role: "leasing_agent" });
    expect(r).toMatchObject({ ok: true });
    const offer = await getPlatform().db.prepare("SELECT status FROM renewal_offers WHERE workspace_id = ? AND id = 'ro-p2'").bind(WS).first<{ status: string }>();
    expect(offer?.status).toBe("Sent");
    expect(await count("SELECT count(*) AS n FROM messages WHERE workspace_id = ? AND body = ? AND drafted_by_agent = 'renewals'", WS, JSON.parse(String(p.payload)).body)).toBe(1);
  });
});
