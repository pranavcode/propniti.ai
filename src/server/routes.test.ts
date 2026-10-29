import { describe, expect, it, vi } from "vitest";
import { openSqlite } from "@/lib/platform/sqlite";
import { seed } from "@/lib/seed";
import type { DemoState } from "@/lib/types";

const { db } = vi.hoisted(() => ({ db: { current: null as ReturnType<typeof openSqlite> | null } }));
vi.mock("@/lib/platform", () => ({ getPlatform: () => ({ db: (db.current ??= openSqlite(":memory:")) }) }));

const state = await import("@/app/api/state/route");
const approve = await import("@/app/api/work-orders/[id]/approve/route");
const submit = await import("@/app/api/work-orders/[id]/submit/route");
const pay = await import("@/app/api/invoices/[id]/pay/route");
const nudges = await import("@/app/api/nudges/route");
const disburse = await import("@/app/api/owners/[id]/disburse/route");

const ORIGIN = "http://localhost:3000";
const post = (path: string, body: unknown, { cookie, origin = ORIGIN, headers = {} }: { cookie?: string; origin?: string | null; headers?: Record<string, string> } = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { host: "localhost:3000", ...(origin && { origin }), ...(cookie && { cookie }), ...headers },
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];

describe("demo data routes", () => {
  it("serve seed data and a cookie to a first-time reader, without creating a workspace", async () => {
    const res = await state.GET(new Request(`${ORIGIN}/api/state`));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^pn_ws=[\w-]{22,}; Path=\/; HttpOnly; SameSite=Lax/);
    expect(((await res.json()) as { state: DemoState }).state).toEqual(seed());
  });

  it("refuse cross-site posts (403), bad bodies (400) and oversized bodies (413)", async () => {
    expect((await nudges.POST(post("/api/nudges", { userId: "u-t1", message: "hi", actor: "x" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await nudges.POST(post("/api/nudges", { userId: "u-t1", message: "hi", actor: "x" }, { origin: null }))).status).toBe(403);
    expect((await submit.POST(post("/api/work-orders/WO-1041/submit", { items: "lots" }), params("WO-1041"))).status).toBe(400);
    expect((await nudges.POST(post("/api/nudges", "{"))).status).toBe(400);
    expect((await nudges.POST(post("/api/nudges", { userId: "u-t1", message: "x".repeat(70 * 1024), actor: "x" }))).status).toBe(413);
    expect((await disburse.POST(post("/api/owners/u-owner1/disburse", {}), params("u-owner1"))).status).toBe(400); // no Idempotency-Key
  });

  it("create a workspace on the first write, then keep using it", async () => {
    const first = await nudges.POST(post("/api/nudges", { userId: "u-t2", message: "Rent reminder", actor: "Maya Patel" }));
    expect(first.status).toBe(200);
    const cookie = cookieOf(first);
    const again = await state.GET(new Request(`${ORIGIN}/api/state`, { headers: { cookie } }));
    expect(again.headers.get("set-cookie")).toBeNull();
    expect(((await again.json()) as { state: DemoState }).state.notifications[0].message).toBe("Rent reminder");
  });

  it("answer a refused approval with 409, the reason and the fresh state", async () => {
    const cookie = cookieOf(await state.GET(new Request(`${ORIGIN}/api/state`)));
    const res = await approve.POST(post("/api/work-orders/WO-1043/approve", {}, { cookie }), params("WO-1043"));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; state: DemoState };
    expect(body.error).toMatch(/Only submitted work/);
    expect(body.state.workOrders).toHaveLength(seed().workOrders.length);
  });

  it("apply changes from two tabs at once without losing either (the old cross-tab race)", async () => {
    const cookie = cookieOf(await state.GET(new Request(`${ORIGIN}/api/state`)));
    const results = await Promise.all([
      pay.POST(post("/api/invoices/INV-2611-03/pay", {}, { cookie }), params("INV-2611-03")),
      approve.POST(post("/api/work-orders/WO-1041/approve", {}, { cookie }), params("WO-1041")),
      approve.POST(post("/api/work-orders/WO-1041/approve", {}, { cookie }), params("WO-1041")),
      nudges.POST(post("/api/nudges", { userId: "u-t2", message: "From tab two", actor: "Maya Patel" }, { cookie })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 409]);
    const s = ((await (await state.GET(new Request(`${ORIGIN}/api/state`, { headers: { cookie } }))).json()) as { state: DemoState }).state;
    expect(s.invoices.find((i) => i.id === "INV-2611-03")?.status).toBe("Processing");
    expect(s.workOrders.find((w) => w.id === "WO-1041")?.status).toBe("Payment pending");
    expect(s.transfers.filter((t) => t.key === "vendor:WO-1041")).toHaveLength(1);
    expect(s.notifications.some((n) => n.message === "From tab two")).toBe(true);
  });
});
