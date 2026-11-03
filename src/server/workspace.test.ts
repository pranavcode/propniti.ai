import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/entities/types";
import "@/entities";
import { openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { createRecord, getRow, updateRecord } from "./query";
import { randomId } from "./repo";
import { resolveWorkspace } from "./workspace";

// v2 workspaces are overlays on the shared base: creating one is a single row, and the generic
// write path (copy-on-write into the overlay) works on it straight away.

const T0 = Date.parse("2026-11-04T17:00:00Z");
const marcus: Actor = { personaId: "marcus", name: "Marcus Bell", role: "property_manager", scope: { kind: "property", ids: ["p01", "p02", "p03"], label: "3 Austin properties" }, propertyIds: ["p01", "p02", "p03"] };
let db: Db;
beforeAll(() => {
  db = openSqlite(":memory:");
}, 240_000);

const rowsIn = async (ws: string) => {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('meta', 'base_balances', 'd1_migrations', 'sqlite_sequence')").all<{ name: string }>()).results;
  let n = 0;
  for (const { name } of tables) n += Number((await db.prepare(`SELECT count(*) AS n FROM ${name} WHERE ${name === "workspaces" ? "id" : "workspace_id"} = ?1`).bind(ws).first<{ n: number }>())!.n);
  return n;
};

describe("workspace creation", { timeout: 60_000 }, () => {
  it("inserts exactly one row, then a generic create and update succeed in the overlay", async () => {
    const ws = randomId();
    const r = await resolveWorkspace(db, new Request("http://x/app", { headers: { cookie: `pn_ws=${ws}` } }), T0, true, false);
    expect(r).toEqual({ ws });
    expect(await rowsIn(ws)).toBe(1);

    const ctx = { db, ws, actor: marcus, nowMs: T0 };
    const prospect = await createRecord(ctx, "prospects", { name: "Dana Whitfield", property_id: "p01", stage: "Inquiry", source: "Website", created_at: "2026-11-04T17:00:00Z" });
    expect(prospect).toMatchObject({ name: "Dana Whitfield" });
    const base = (await db.prepare("SELECT id, name FROM prospects WHERE workspace_id = 'base' AND property_id = 'p01' AND stage = 'Lost' LIMIT 1").first<{ id: string; name: string }>())!;
    await updateRecord(ctx, "prospects", base.id, { phone: "(512) 555-0199" });
    expect(await getRow(ctx, "prospects", base.id)).toMatchObject({ phone: "(512) 555-0199" });
    // Copy-on-write: the base row is untouched.
    expect(await db.prepare("SELECT phone FROM prospects WHERE workspace_id = 'base' AND id = ?1").bind(base.id).first<{ phone: string }>()).not.toEqual({ phone: "(512) 555-0199" });
  });
});
