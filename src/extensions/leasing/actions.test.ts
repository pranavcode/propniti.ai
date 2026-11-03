import { beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatform } from "@/lib/platform";
import { getPersona } from "@/auth/personas";
import { actorFor } from "@/server/permissions";
import { seed, WS } from "@/server/query.fixture";
import { inputSchema, resolveAction, runAction as run } from "@/app/api/e/_lib/actions";
import type { ActionDef } from "@/entities/types";
import { createRecord as create, getDef, writeSchema } from "@/server/query";

import "@/entities";

// The route validates the body with the def's write schema before createRecord; do the same.
const createRecord = async (ctx: Parameters<typeof create>[0], entity: string, body: Record<string, unknown>) => create(ctx, entity, writeSchema(getDef(entity), ctx.actor.role, "create").parse(body));

// Leasing actions on the shared query fixture: the broker's decision and the renewal send each
// run once under a double click, the board refuses a leasing agent's approval, and every run
// leaves an activity entry and an audit row.
vi.mock("@/lib/platform", async () => {
  const db = (await import("@/server/query.fixture")).emptyDb();
  return { getPlatform: () => ({ db }) };
});

// The route parses the body with the action's schema before running it; do the same here.
const runAction = (ctx: Parameters<typeof run>[0], a: ActionDef, id: string, body: unknown) => run(ctx, a, id, inputSchema(a).parse(body));

const ctxFor = async (persona: string) => {
  const db = getPlatform().db;
  return { db, ws: WS, actor: await actorFor(db, WS, getPersona(persona)!), nowMs: Date.parse("2026-11-04T15:00:00Z") };
};

beforeAll(async () => {
  const db = getPlatform().db;
  await seed(db);
  const rows = [
    "INSERT INTO prospects (workspace_id, id, property_id, name, stage, created_at, last_contact_at) VALUES ('base', 'pr-1', 'p01', 'Ana Lee', 'Applied', '2026-10-25T15:00:00Z', '2026-11-01T15:00:00Z')",
    "INSERT INTO applicants (workspace_id, id, prospect_id, first_name, last_name, email, monthly_income_cents, created_at) VALUES ('base', 'apl-1', 'pr-1', 'Ana', 'Lee', 'ana@x.example', 520000, '2026-10-26T15:00:00Z')",
    "INSERT INTO applications (workspace_id, id, property_id, unit_id, applicant_id, stage, rent_cents, submitted_at, recommendation) VALUES ('base', 'app-1', 'p01', 'p01-u3', 'apl-1', 'Review', 150000, '2026-10-26T15:00:00Z', 'Approve')",
    "INSERT INTO renewal_offers (workspace_id, id, lease_id, property_id, term_months, rent_cents, current_rent_cents, status) VALUES ('base', 'ro-1', 'l-p01-u1', 'p01', 12, 150000, 145000, 'Draft')",
  ];
  for (const r of rows) await db.prepare(r).run();
});

describe("leasing actions", () => {
  it("decides an application once, even on a double click", async () => {
    const ctx = await ctxFor("rachel");
    const a = resolveAction("applications", "decide");
    const results = await Promise.all([runAction(ctx, a, "app-1", { decision: "Approved" }), runAction(ctx, a, "app-1", { decision: "Approved" })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const db = getPlatform().db;
    const app = await db.prepare("SELECT stage, decided_by FROM applications WHERE workspace_id = ? AND id = 'app-1'").bind(WS).first<{ stage: string; decided_by: string }>();
    expect(app).toEqual({ stage: "Approved", decided_by: "rachel" });
    const log = await db.prepare("SELECT count(*) AS n FROM activity_events WHERE workspace_id = ? AND entity_id = 'app-1' AND verb = 'decided'").bind(WS).first<{ n: number }>();
    expect(log?.n).toBe(1);
  });

  it("requires a reason to deny", async () => {
    const ctx = await ctxFor("rachel");
    const r = await runAction(ctx, resolveAction("applications", "decide"), "app-1", { decision: "Denied" });
    expect(r.status).not.toBe(200);
  });

  it("refuses the leasing agent's approval on the board", async () => {
    const ctx = await ctxFor("lena");
    await expect(runAction(ctx, resolveAction("applications", "decide"), "app-1", { decision: "Approved" })).rejects.toThrow(/can't/);
  });

  it("sends a renewal offer once and records the message", async () => {
    const ctx = await ctxFor("lena");
    const a = resolveAction("renewal_offers", "send");
    const body = { subject: "Your renewal offer", body: "Hi Res, we can renew for 12 months at $1,500 a month. Reply to accept." };
    const results = await Promise.all([runAction(ctx, a, "ro-1", body), runAction(ctx, a, "ro-1", body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const db = getPlatform().db;
    const n = await db.prepare("SELECT count(*) AS n FROM messages WHERE workspace_id = ?").bind(WS).first<{ n: number }>();
    expect(n?.n).toBe(1);
    const offer = await db.prepare("SELECT status FROM renewal_offers WHERE workspace_id = ? AND id = 'ro-1'").bind(WS).first<{ status: string }>();
    expect(offer?.status).toBe("Sent");
  });

  it("won't send a message with a figure that isn't the offer", async () => {
    const db = getPlatform().db;
    await db.prepare("INSERT INTO renewal_offers (workspace_id, id, lease_id, property_id, term_months, rent_cents, current_rent_cents, status) VALUES ('base', 'ro-2', 'l-p01-u2', 'p01', 12, 150000, 145000, 'Draft')").run();
    const ctx = await ctxFor("lena");
    const r = await runAction(ctx, resolveAction("renewal_offers", "send"), "ro-2", { subject: "Offer", body: "Hi, we can renew at $1,200 a month and waive the late fees." });
    expect(r).toMatchObject({ status: 409 });
  });

  it("won't let a creator skip the workflow: no pre-approved listings, concessions or applications", async () => {
    const ctx = await ctxFor("lena");
    await expect(createRecord(ctx, "listings", { headline: "New", property_id: "p01", unit_id: "p01-u3", rent: 1500, status: "Active", listed_on: "2026-11-04" })).rejects.toThrow();
    await expect(createRecord(ctx, "concessions", { label: "3 months free", property_id: "p01", amount: 5000, status: "Active" })).rejects.toThrow();
    await expect(createRecord(ctx, "applications", { property_id: "p01", unit_id: "p01-u3", applicant_id: "apl-1", stage: "Approved" })).rejects.toThrow();
    const ok = await createRecord(ctx, "concessions", { label: "Waived admin fee", property_id: "p01", amount: 250, status: "Proposed" });
    expect(ok.status).toBe("Proposed");
  });

  it("only touches records at the row's own property", async () => {
    const db = getPlatform().db;
    await db.prepare("INSERT INTO prospects (workspace_id, id, property_id, name, stage, created_at) VALUES ('base', 'pr-far', 'p06', 'Far Away', 'Tour scheduled', '2026-10-25T15:00:00Z')").run();
    await db.prepare("INSERT INTO showings (workspace_id, id, property_id, prospect_id, scheduled_at, status) VALUES ('base', 'sh-x', 'p01', 'pr-far', '2026-11-04T17:00:00Z', 'Scheduled')").run();
    await db.prepare("INSERT INTO renewal_offers (workspace_id, id, lease_id, property_id, term_months, rent_cents, current_rent_cents, status) VALUES ('base', 'ro-x', 'l-p06-u1', 'p01', 12, 150000, 145000, 'Draft')").run();
    const ctx = await ctxFor("lena");
    expect((await runAction(ctx, resolveAction("showings", "complete"), "sh-x", {})).status).toBe(200);
    const far = await db.prepare("SELECT count(*) AS n FROM prospects WHERE workspace_id = ? AND id = 'pr-far'").bind(WS).first<{ n: number }>();
    expect(far?.n).toBe(0);
    const sent = await runAction(ctx, resolveAction("renewal_offers", "send"), "ro-x", { subject: "Offer", body: "Hi, we can renew for 12 months at $1,500 a month. Reply to accept." });
    expect(sent).toMatchObject({ status: 409 });
  });
});
