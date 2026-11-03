import { describe, expect, it, vi } from "vitest";
import { openSqlite } from "@/lib/platform/sqlite";

const { db } = vi.hoisted(() => ({ db: { current: null as ReturnType<typeof openSqlite> | null } }));
vi.mock("@/lib/platform", () => ({ getPlatform: () => ({ db: (db.current ??= openSqlite(":memory:")) }) }));
const route = await import("@/app/docs/leases/[id]/route");

const get = (id: string, persona: string) => route.GET(new Request(`http://localhost/docs/leases/${id}`, { headers: { cookie: `pn_as=${persona}` } }), { params: Promise.resolve({ id }) });
const one = <T,>(sql: string) => db.current!.prepare(sql).first<T>();

describe("lease documents", { timeout: 240_000 }, () => {
  it("render for a persona who can read the lease and 404 for one who can't", async () => {
    await get("L-10001", "marcus");
    const p01 = (await one<{ id: string; rent_cents: number }>("SELECT id, rent_cents FROM leases WHERE workspace_id = 'base' AND property_id = 'p01' AND status = 'Active' LIMIT 1"))!;
    const res = await get(`${p01.id}.pdf`, "marcus");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    for (const s of ["Residential Lease Agreement", "Security deposit", "Late charges", "Renewal", "The Lofts at Riverside"]) expect(html).toContain(s);
    expect(html).toContain("10% of monthly rent");
    const phoenix = (await one<{ id: string }>("SELECT id FROM leases WHERE workspace_id = 'base' AND property_id = 'p22' LIMIT 1"))!;
    expect((await get(phoenix.id, "marcus")).status).toBe(404);
    expect((await get(phoenix.id, "daniel")).status).toBe(200);
    expect((await get("not-a-lease", "daniel")).status).toBe(404);
  });

  it("shows the document's terms, which differ from the record for the planted mismatches", async () => {
    const ids = JSON.parse((await one<{ value: string }>("SELECT value FROM meta WHERE key = 'lease_doc_mismatches'"))!.value) as string[];
    const leases = Number((await one<{ n: number }>("SELECT count(*) AS n FROM documents WHERE workspace_id = 'base' AND doc_type = 'Lease'"))!.n);
    expect(ids.length / leases).toBeGreaterThan(0.02);
    expect(ids.length / leases).toBeLessThan(0.045);
    const commercial = (await one<{ id: string }>("SELECT id FROM leases WHERE workspace_id = 'base' AND kind = 'Commercial' AND status = 'Active' LIMIT 1"))!;
    const c = await (await get(commercial.id, "daniel")).text();
    for (const s of ["triple net", "pro-rata share", "Rent escalations"]) expect(c).toContain(s);
    for (const id of ids.slice(0, 15)) {
      const d = (await one<{ extracted: string }>(`SELECT extracted FROM documents WHERE workspace_id = 'base' AND entity_id = '${id}' AND doc_type = 'Lease'`))!;
      const l = (await one<{ rent_cents: number; end_on: string | null; deposit_cents: number }>(`SELECT rent_cents, end_on, deposit_cents FROM leases WHERE workspace_id = 'base' AND id = '${id}'`))!;
      const x = JSON.parse(d.extracted);
      expect(x.rent_cents !== l.rent_cents || x.end_on !== l.end_on || x.deposit_cents !== l.deposit_cents, id).toBe(true);
      const html = await (await get(id, "daniel")).text();
      expect(html).toContain(`$${(x.rent_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    }
  });
});
