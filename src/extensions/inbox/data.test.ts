import { beforeAll, describe, expect, it, vi } from "vitest";
import "@/entities";
import { getPlatform } from "@/lib/platform";
import { getPersona } from "@/auth/personas";
import { actorFor } from "@/server/permissions";
import { seed, WS } from "@/server/query.fixture";
import { decidableTypes, inboxCounts, inboxPage } from "./data";

vi.mock("@/lib/platform", async () => {
  const db = (await import("@/server/query.fixture")).emptyDb();
  return { getPlatform: () => ({ db }) };
});

const db = () => getPlatform().db;
const ctx = async (persona: string, ws: string | null = WS) => ({ db: db(), ws, actor: await actorFor(db(), ws, getPersona(persona)!) });
const ids = (r: { items: { id: string }[] }) => r.items.map((i) => i.id);

beforeAll(async () => {
  await seed(db());
  const thread = (id: string, prop: string | null, status: string, assigned: string | null, at: string, unread = 0) =>
    `INSERT INTO message_threads (workspace_id, id, property_id, party_kind, party_id, subject, assigned_to, status, last_message_at, unread) VALUES ('base', '${id}', ${prop ? `'${prop}'` : "NULL"}, 'resident', 'res-${prop ?? "p01"}-u1', 'Subject ${id}', ${assigned ? `'${assigned}'` : "NULL"}, '${status}', '${at}', ${unread})`;
  const proposal = (id: string, entity: string, prop: string | null, role: string | null, at: string, extra: { risk?: string; amount?: number; action?: string; queue?: string; payload?: string; model?: string; run?: string; entityId?: string } = {}) =>
    `INSERT INTO ai_proposals (workspace_id, id, agent, entity_type, entity_id, property_id, action, title, payload, why, confidence, risk, amount_cents, queue_state, assignee_role, model, run_id, created_at) VALUES ('base', '${id}', 'renewals', '${entity}', '${extra.entityId ?? `rec-${id}`}', ${prop ? `'${prop}'` : "NULL"}, '${extra.action ?? `${entity}.do`}', 'Title ${id}', '${extra.payload ?? "{}"}', '["Because ${id}"]', 0.82, '${extra.risk ?? "Low"}', ${extra.amount ?? "NULL"}, '${extra.queue ?? "needs_you"}', ${role ? `'${role}'` : "NULL"}, ${extra.model ? `'${extra.model}'` : "NULL"}, ${extra.run ? `'${extra.run}'` : "NULL"}, '${at}')`;
  for (const s of [
    // Threads: marcus's open ones at p01 and p02, one unassigned, one assigned to someone else,
    // one closed, one outside his scope and one with no property.
    thread("t-mine", "p01", "Open", "marcus", "2026-11-03T10:00:00Z", 1),
    thread("t-unassigned", "p02", "Open", null, "2026-11-02T10:00:00Z"),
    thread("t-other", "p01", "Open", "s-kofi", "2026-11-03T11:00:00Z"),
    thread("t-closed", "p01", "Closed", "marcus", "2026-11-03T12:00:00Z"),
    thread("t-dallas", "p04", "Open", "marcus", "2026-11-03T13:00:00Z"),
    thread("t-org", null, "Open", null, "2026-11-03T14:00:00Z"),
    "INSERT INTO messages (workspace_id, id, thread_id, channel, direction, sender_kind, sender_id, body, sent_at) VALUES ('base', 'm1', 't-mine', 'SMS', 'in', 'resident', 'res-p01-u1', 'The dishwasher is leaking again.', '2026-11-03T10:00:00Z')",
    // Proposals.
    proposal("pr-renewal", "leases", "p01", "property_manager", "2026-11-03T09:00:00Z", { risk: "Medium", amount: 150000 }),
    proposal("pr-fix", "residents", "p02", "admin", "2026-11-03T08:00:00Z"),
    proposal("pr-bill-low", "bills", "p01", "accountant", "2026-11-03T07:00:00Z", { amount: 50000 }),
    proposal("pr-bill-high", "bills", "p05", "accountant", "2026-11-03T06:00:00Z", { risk: "High", amount: 900000 }),
    proposal("pr-dallas", "leases", "p04", "property_manager", "2026-11-03T05:00:00Z", { risk: "Medium", amount: 150000 }),
    proposal("pr-decided", "leases", "p01", "property_manager", "2026-11-03T04:00:00Z"),
    proposal("pr-auto", "leases", "p01", "property_manager", "2026-11-03T03:00:00Z", { queue: "auto_handled" }),
    proposal("pr-reply", "message_threads", "p01", null, "2026-11-03T10:30:00Z", { entityId: "t-mine", action: "message_threads.reply", payload: '{"input":{"body":"Thanks, a technician will call you today."},"source":"live"}', model: "llama", run: "run-1" }),
    "INSERT INTO ai_decisions (workspace_id, id, proposal_id, decision, decided_by, decided_at) VALUES ('base', 'd1', 'pr-decided', 'Approved', 'marcus', '2026-11-03T04:30:00Z')",
    // Notifications.
    "INSERT INTO notifications (workspace_id, id, user_id, title, body, href, entity_type, entity_id, read_at, at) VALUES ('base', 'n-m1', 'marcus', 'Work order past SLA', 'WO-1 at The Lofts', '/app/maintenance/work-orders/WO-1', 'work_orders', 'WO-1', NULL, '2026-11-03T15:00:00Z')",
    "INSERT INTO notifications (workspace_id, id, user_id, title, body, href, read_at, at) VALUES ('base', 'n-m2', 'marcus', 'Old news', '', 'javascript:alert(1)', '2026-11-01T00:00:00Z', '2026-10-30T15:00:00Z')",
    "INSERT INTO notifications (workspace_id, id, user_id, title, body, href, read_at, at) VALUES ('base', 'n-g1', 'grace', 'Trust account unreconciled', '', '/app/banking', NULL, '2026-11-03T16:00:00Z')",
  ]) await db().prepare(s).run();
});

describe("inbox: who decides what", () => {
  it("lists entity types a role may decide, split by approve and write access", () => {
    const pm = decidableTypes("property_manager");
    expect(pm.write).toContain("residents");
    expect(pm.write).not.toContain("bills");
    expect(pm.approve).not.toContain("leases");
    const acct = decidableTypes("accountant");
    expect(acct.approve).toContain("bills");
    expect(acct.write).not.toContain("residents");
  });
});

describe("inbox for a property manager (marcus, 3 Austin properties)", () => {
  it("shows his open conversations, approvals routed to him or that he can decide, and his alerts, newest first", async () => {
    const r = await inboxPage(await ctx("marcus"), {});
    expect(ids(r)).toEqual(["n-m1", "t-mine", "pr-renewal", "pr-fix", "t-unassigned", "n-m2"]);
  });

  it("keeps out other people's threads, closed threads, out-of-scope and property-less records, decided and auto-handled proposals and reply drafts", async () => {
    const got = new Set(ids(await inboxPage(await ctx("marcus"), {})));
    for (const id of ["t-other", "t-closed", "t-dallas", "t-org", "pr-dallas", "pr-decided", "pr-auto", "pr-reply", "pr-bill-low", "pr-bill-high", "n-g1"]) expect(got.has(id)).toBe(false);
  });

  it("shows a thread's last message, unread state and the open AI reply draft with its source", async () => {
    const r = await inboxPage(await ctx("marcus"), { filter: "messages" });
    const t = r.items.find((i) => i.id === "t-mine")!;
    expect(t).toMatchObject({ kind: "message", unread: true, property: "The Lofts at Riverside", who: "Res p01-u1", title: "Subject t-mine", detail: "The dishwasher is leaking again." });
    expect(t.ai).toEqual({ label: "Suggested reply", text: "Thanks, a technician will call you today.", source: "live", model: "llama" });
    expect(t.action).toEqual({ label: "Reply", href: "/app/communications/inbox?t=t-mine" });
    expect(t.peek).toEqual({ entity: "message_threads", id: "t-mine", href: "/app/communications/inbox?t=t-mine" });
    expect(r.items.find((i) => i.id === "t-unassigned")?.ai).toBeNull();
  });

  it("links approvals to the approvals deep link and peeks the record they act on", async () => {
    const r = await inboxPage(await ctx("marcus"), { filter: "approvals" });
    const p = r.items.find((i) => i.id === "pr-renewal")!;
    expect(p).toMatchObject({ kind: "approval", risk: "Medium", amountCents: 150000, title: "Title pr-renewal", agent: "renewals" });
    expect(p.ai).toMatchObject({ label: "Why", text: "Because pr-renewal", source: "rules", confidence: 0.82 });
    expect(p.action).toEqual({ label: "Review", href: "/app/ai/approvals?proposal=pr-renewal" });
    expect(p.peek?.entity).toBe("leases");
  });

  it("only links alerts into the app", async () => {
    const r = await inboxPage(await ctx("marcus"), { filter: "alerts" });
    expect(r.items.find((i) => i.id === "n-m1")).toMatchObject({ unread: true, action: { label: "Open", href: "/app/maintenance/work-orders/WO-1" }, peek: { entity: "work_orders", id: "WO-1" } });
    expect(r.items.find((i) => i.id === "n-m2")).toMatchObject({ unread: false, action: null });
  });

  it("counts each kind and the items that need him (unread alerts only)", async () => {
    const c = await inboxCounts(await ctx("marcus"));
    expect(c).toEqual({ messages: 2, approvals: 2, alerts: 2, unreadAlerts: 1, needsYou: 5 });
  });

  it("filters by kind and pages on the server", async () => {
    const c = await ctx("marcus");
    const first = await inboxPage(c, { size: 2 });
    const second = await inboxPage(c, { size: 2, page: 2 });
    expect(first.total).toBe(6);
    expect([...ids(first), ...ids(second)]).toEqual(["n-m1", "t-mine", "pr-renewal", "pr-fix"]);
    expect(ids(await inboxPage(c, { filter: "messages" }))).toEqual(["t-mine", "t-unassigned"]);
  });

  it("reads the visitor's overlay: a decision clears the approval and a read alert stops counting", async () => {
    await db().prepare("INSERT INTO ai_decisions (workspace_id, id, proposal_id, decision, decided_by, decided_at) VALUES (?, 'd2', 'pr-fix', 'Approved', 'marcus', '2026-11-04T09:00:00Z')").bind(WS).run();
    await db().prepare("INSERT INTO notifications (workspace_id, id, user_id, title, body, href, entity_type, entity_id, read_at, at) SELECT ?, id, user_id, title, body, href, entity_type, entity_id, '2026-11-04T09:00:00Z', at FROM notifications WHERE workspace_id = 'base' AND id = 'n-m1'").bind(WS).run();
    expect(await inboxCounts(await ctx("marcus"))).toEqual({ messages: 2, approvals: 1, alerts: 2, unreadAlerts: 0, needsYou: 3 });
    // Without a workspace, base rows only.
    expect((await inboxCounts(await ctx("marcus", null))).approvals).toBe(2);
  });
});

describe("inbox for other roles", () => {
  it("gives an accountant bills to decide and her alerts, and no conversations (communications isn't her module)", async () => {
    const r = await inboxPage(await ctx("grace"), {});
    expect(new Set(ids(r))).toEqual(new Set(["n-g1", "pr-bill-low", "pr-bill-high"]));
  });

  it("gives an org-wide principal every pending proposal and unassigned or org-level threads", async () => {
    const got = new Set(ids(await inboxPage(await ctx("daniel"), {})));
    for (const id of ["pr-renewal", "pr-bill-high", "pr-dallas", "t-unassigned", "t-org"]) expect(got.has(id)).toBe(true);
    for (const id of ["t-mine", "t-other", "n-m1"]) expect(got.has(id)).toBe(false);
  });
});
