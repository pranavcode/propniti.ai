import { beforeAll, describe, expect, it, vi } from "vitest";
import "@/entities";
import { getPlatform } from "@/lib/platform";
import * as listRoute from "@/app/api/e/[entity]/route";
import * as recordRoute from "@/app/api/e/[entity]/[id]/route";

// Banking is scoped through the owner entity: Priya (Texas) sees Texas entities' accounts,
// reconciliations and bank lines, never Georgia's or Arizona's, and not the management company's
// own operating account. Runs the real /api/e handlers on the full generated base.

vi.mock("@/lib/platform", async () => {
  const db = (await import("@/lib/platform/sqlite")).openSqlite(":memory:");
  return { getPlatform: () => ({ db }) };
});

const WS = "banking-scope-workspace-0001";
const host = "propniti.test";
const req = (path: string, persona: string) => new Request(`http://${host}${path}`, { headers: { host, cookie: `pn_as=${persona}; pn_ws=${WS}` } });
const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) });

// oe01–oe03 own the Texas properties; oe04–oe05 Atlanta; oe06–oe08 Phoenix.
const TEXAS = new Set(["oe01", "oe02", "oe03"]);
let outside: { account: string; rec: string; line: string };

beforeAll(async () => {
  const db = getPlatform().db;
  await db.prepare("INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES (?, 'demo', 0, 0)").bind(WS).run();
  const rec = await db.prepare("SELECT id FROM bank_reconciliations WHERE workspace_id = 'base' AND bank_account_id = 'ba-oe04-trust' LIMIT 1").first<{ id: string }>();
  const line = await db.prepare("SELECT id FROM bank_transactions WHERE workspace_id = 'base' AND bank_account_id = 'ba-oe06-trust' LIMIT 1").first<{ id: string }>();
  outside = { account: "ba-oe04-trust", rec: rec!.id, line: line!.id };
}, 180_000);

const list = async (entity: string, persona: string, q = "size=100") => (await (await listRoute.GET(req(`/api/e/${entity}?${q}`, persona), p({ entity }))).json()) as { rows: Record<string, unknown>[]; total: number };
const one = async (entity: string, id: string, persona: string) => (await recordRoute.GET(req(`/api/e/${entity}/${id}?relations=0`, persona), p({ entity, id }))).status;

describe("banking scope", () => {
  it("lists only Texas entities' bank accounts for the Texas regional manager", async () => {
    const r = await list("bank_accounts", "priya");
    expect(r.total).toBe(6);
    expect(r.rows.every((a) => TEXAS.has(String(a.owner_entity_id)))).toBe(true);
    expect(r.rows.some((a) => a.id === "ba-mgmt")).toBe(false);
    expect((await list("bank_accounts", "grace")).total).toBe(17);
  });

  it("refuses Georgia and Arizona accounts, reconciliations and bank lines by id", async () => {
    expect(await one("bank_accounts", outside.account, "priya")).toBe(404);
    expect(await one("bank_reconciliations", outside.rec, "priya")).toBe(404);
    expect(await one("bank_transactions", outside.line, "priya")).toBe(404);
    expect(await one("bank_accounts", "ba-mgmt", "priya")).toBe(404);
    expect(await one("bank_accounts", outside.account, "grace")).toBe(200);
    expect(await one("bank_reconciliations", outside.rec, "grace")).toBe(200);
  });

  it("keeps reconciliation and bank-line lists inside the region", async () => {
    const recs = await list("bank_reconciliations", "priya");
    expect(recs.total).toBeGreaterThan(0);
    expect(recs.rows.every((r) => /^ba-oe0[123]-/.test(String(r.bank_account_id)))).toBe(true);
    const lines = await list("bank_transactions", "priya", "size=100&f.bank_account_id=ba-oe06-trust");
    expect(lines.total).toBe(0);
  });
});
