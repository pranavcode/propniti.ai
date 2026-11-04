import { beforeEach, describe, expect, it } from "vitest";
import "@/entities";
import { can } from "@/entities";
import { getPersona } from "@/auth/personas";
import type { Db } from "@/lib/platform/types";
import { withActorNames } from "./actors";
import { actorFor } from "./permissions";
import { emptyDb, seed, WS } from "./query.fixture";
import type { QueryCtx } from "./query";

let db: Db;
const ctx = async (persona: string, ws: string | null = WS): Promise<QueryCtx> => ({ db, ws, actor: await actorFor(db, ws, getPersona(persona)!) });
beforeEach(async () => {
  db = emptyDb();
  await seed(db);
  await db.prepare("INSERT INTO staff (workspace_id, id, org_id, name, title, email) VALUES ('base', 's-lucy', 'org', 'Lucy Park', 'AP specialist', 'lucy@example.com')").run();
  await db.prepare("INSERT INTO residents (workspace_id, id, household_id, property_id, first_name, last_name, email) VALUES ('base', 'res-p01-0001', 'hh1', 'p01', 'Jordan', 'Lee', 'jordan@x.example')").run();
});

const ROWS = [
  { actor_kind: "staff", actor_id: "s-lucy" },
  { actor_kind: "staff", actor_id: "grace" },
  { actor_kind: "agent", actor_id: "payables" },
  { actor_kind: "staff", actor_id: "Grace Kim" },
  { actor_kind: "resident", actor_id: "res-p01-0001" },
];

describe("withActorNames", () => {
  it("resolves staff, resident and persona ids to names for staff, leaves agents and unknown actors alone", async () => {
    const rows = await withActorNames(await ctx("marcus"), ROWS, "actor_id", "actor_name");
    expect(rows.map((r) => r.actor_name)).toEqual(["Lucy Park", "Grace Kim", undefined, undefined, "Jordan Lee"]);
  });

  it("never shows a resident's name to a role that can't read residents", async () => {
    const vendor = await ctx("vendor");
    expect(can(vendor.actor.role, "read", "work_orders")).toBe(true);
    expect(can(vendor.actor.role, "read", "residents")).toBe(false);
    const rows = await withActorNames(vendor, ROWS, "actor_id", "actor_name");
    expect(rows.map((r) => r.actor_name)).toEqual(["Lucy Park", "Grace Kim", undefined, undefined, "Resident"]);
    expect(JSON.stringify(rows)).not.toContain("Jordan");
  });

  it("names note authors", async () => {
    const [n] = await withActorNames(await ctx("grace", null), [{ author_id: "s-lucy" }], "author_id", "author_name");
    expect(n.author_name).toBe("Lucy Park");
  });

  it("does nothing without rows", async () => {
    expect(await withActorNames(await ctx("marcus"), [], "actor_id", "actor_name")).toEqual([]);
  });
});
