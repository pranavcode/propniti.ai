import { beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatform } from "@/lib/platform";
import { getPersona } from "@/auth/personas";
import { actorFor } from "@/server/permissions";
import { seed, WS } from "@/server/query.fixture";
import { resolveAction, runAction } from "@/app/api/e/_lib/actions";

import "@/entities";

// Renters insurance reminders run from a list in bulk, so a double click (or the same policy in
// two chunks) must message the resident once a day.
vi.mock("@/lib/platform", async () => {
  const db = (await import("@/server/query.fixture")).emptyDb();
  return { getPlatform: () => ({ db }) };
});

const ctxFor = async (persona: string) => {
  const db = getPlatform().db;
  return { db, ws: WS, actor: await actorFor(db, WS, getPersona(persona)!), nowMs: Date.parse("2026-11-04T15:00:00Z") };
};

beforeAll(async () => {
  const db = getPlatform().db;
  await seed(db);
  await db.prepare("INSERT INTO renters_insurance (workspace_id, id, lease_id, property_id, carrier, policy_number, liability_cents, starts_on, expires_on, status) VALUES ('base', 'ri-1', 'l-p01-u1', 'p01', 'Lemonade', 'LM-1', 10000000, '2025-11-01', '2026-10-31', 'Lapsed'), ('base', 'ri-2', 'l-p01-u2', 'p01', 'Lemonade', 'LM-2', 10000000, '2026-01-01', '2026-12-31', 'Active')").run();
});

describe("renters insurance reminder", () => {
  it("messages the lease's resident once, even on a double click", async () => {
    const ctx = await ctxFor("marcus");
    const a = resolveAction("renters_insurance", "send_reminder");
    const results = await Promise.all([runAction(ctx, a, "ri-1", {}), runAction(ctx, a, "ri-1", {})]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const db = getPlatform().db;
    const msgs = await db.prepare("SELECT m.body, t.party_id, t.entity_id FROM messages m JOIN message_threads t ON t.id = m.thread_id AND t.workspace_id = m.workspace_id WHERE m.workspace_id = ?").bind(WS).all<{ body: string; party_id: string; entity_id: string }>();
    expect(msgs.results).toHaveLength(1);
    expect(msgs.results[0]).toMatchObject({ party_id: "res-p01-u1", entity_id: "ri-1" });
    expect(msgs.results[0].body).toContain("LM-1");
  });

  it("leaves the thread alone when a later click the same day is refused", async () => {
    const db = getPlatform().db;
    const before = await db.prepare("SELECT status, last_message_at FROM message_threads WHERE workspace_id = ? AND id = 'thr-ins-ri-1'").bind(WS).first();
    await db.prepare("UPDATE message_threads SET status = 'Closed' WHERE workspace_id = ? AND id = 'thr-ins-ri-1'").bind(WS).run();
    const ctx = { ...(await ctxFor("marcus")), nowMs: Date.parse("2026-11-04T18:00:00Z") };
    expect((await runAction(ctx, resolveAction("renters_insurance", "send_reminder"), "ri-1", {})).status).toBe(409);
    const after = await db.prepare("SELECT status, last_message_at FROM message_threads WHERE workspace_id = ? AND id = 'thr-ins-ri-1'").bind(WS).first();
    expect(after).toEqual({ status: "Closed", last_message_at: before!.last_message_at });
  });

  it("isn't offered for an active policy", async () => {
    const r = await runAction(await ctxFor("marcus"), resolveAction("renters_insurance", "send_reminder"), "ri-2", {});
    expect(r.status).toBe(409);
  });
});
