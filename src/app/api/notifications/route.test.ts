import { beforeAll, describe, expect, it, vi } from "vitest";
import { getPlatform } from "@/lib/platform";
import { seed, WS } from "@/server/query.fixture";
import * as feed from "./route";
import * as read from "./read/route";

vi.mock("@/lib/platform", async () => {
  const db = (await import("@/server/query.fixture")).emptyDb();
  return { getPlatform: () => ({ db }) };
});

const host = "propniti.test";
const req = (path: string, init: RequestInit & { persona?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set("host", host);
  headers.set("cookie", `pn_as=${init.persona ?? "marcus"}; pn_ws=${WS}`);
  if (init.method === "POST") headers.set("origin", `http://${host}`);
  return new Request(`http://${host}${path}`, { ...init, headers });
};
const post = (body: unknown, persona?: string) => read.POST(req("/api/notifications/read", { method: "POST", body: JSON.stringify(body), persona }));

beforeAll(async () => {
  const db = getPlatform().db;
  await seed(db);
  const rows = [
    ["n1", "marcus", "Bill BILL-20412 needs your approval", "/app/payables/bills/BILL-20412", "2026-10-27T10:00:00Z"],
    ["n2", "marcus", "Work order WO-10001 is past SLA", "/app/maintenance/work-orders/WO-10001", "2026-10-28T09:00:00Z"],
    ["n3", "marcus", "Bad link", "javascript:alert(1)", "2026-10-26T09:00:00Z"],
    ["n4", "grace", "Reconciliation ready", "/app/banking", "2026-10-28T08:00:00Z"],
    ["n5", "res-p01-0001", "Rent receipt", "/portal/resident", "2026-10-28T08:00:00Z"],
  ];
  for (const [id, user, title, href, at] of rows) {
    await db.prepare("INSERT INTO notifications (workspace_id, id, user_id, title, href, at) VALUES ('base', ?, ?, ?, ?, ?)").bind(id, user, title, href, at).run();
  }
});

describe("notifications", () => {
  it("lists the persona's own notifications newest first, with safe links", async () => {
    const body = await (await feed.GET(req("/api/notifications"))).json();
    expect(body.unread).toBe(3);
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(["n2", "n1", "n3"]);
    expect(body.rows[2].href).toBeNull();
  });

  it("includes a portal user's record id", async () => {
    const body = await (await feed.GET(req("/api/notifications", { persona: "resident" }))).json();
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(["n5"]);
  });

  it("marks listed ids read in the overlay and leaves base rows alone", async () => {
    expect((await post({ ids: ["n1", "n4"] })).status).toBe(200);
    const body = await (await feed.GET(req("/api/notifications"))).json();
    expect(body.unread).toBe(2);
    const base = await getPlatform().db.prepare("SELECT read_at FROM notifications WHERE workspace_id = 'base' AND id = 'n1'").first<{ read_at: string | null }>();
    expect(base?.read_at).toBeNull();
    const grace = await (await feed.GET(req("/api/notifications", { persona: "grace" }))).json();
    expect(grace.unread).toBe(1);
  });

  it("double clicks on mark-all write each row once", async () => {
    const [a, b] = await Promise.all([post({}), post({})]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const n = await getPlatform().db.prepare(`SELECT count(*) AS n FROM notifications WHERE workspace_id = ? AND user_id = 'marcus'`).bind(WS).first<{ n: number }>();
    expect(n?.n).toBe(3);
    expect((await (await feed.GET(req("/api/notifications"))).json()).unread).toBe(0);
  });

  it("refuses bad bodies and cross-site posts", async () => {
    expect((await post({ ids: "n1" })).status).toBe(400);
    const headers = new Headers({ host, cookie: `pn_as=marcus; pn_ws=${WS}`, origin: "https://evil.example" });
    expect((await read.POST(new Request(`http://${host}/api/notifications/read`, { method: "POST", body: "{}", headers }))).status).toBe(403);
  });
});
