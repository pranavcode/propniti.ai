import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/platform/types";
import { withActorNames } from "./actors";
import { emptyDb, seed, WS } from "./query.fixture";

let db: Db;
beforeEach(async () => {
  db = emptyDb();
  await seed(db);
  await db.prepare("INSERT INTO staff (workspace_id, id, org_id, name, title, email) VALUES ('base', 's-lucy', 'org', 'Lucy Park', 'AP specialist', 'lucy@example.com')").run();
  await db.prepare("INSERT INTO residents (workspace_id, id, household_id, property_id, first_name, last_name, email) VALUES ('base', 'res-p01-0001', 'hh1', 'p01', 'Jordan', 'Lee', 'jordan@x.example')").run();
});

describe("withActorNames", () => {
  it("resolves staff, resident and persona ids to names, leaves agents and unknown actors alone", async () => {
    const rows = await withActorNames(db, WS, [
      { actor_kind: "staff", actor_id: "s-lucy" },
      { actor_kind: "staff", actor_id: "grace" },
      { actor_kind: "agent", actor_id: "payables" },
      { actor_kind: "staff", actor_id: "Grace Kim" },
      { actor_kind: "resident", actor_id: "res-p01-0001" },
    ], "actor_id", "actor_name");
    expect(rows.map((r) => r.actor_name)).toEqual(["Lucy Park", "Grace Kim", undefined, undefined, "Jordan Lee"]);
  });

  it("names note authors", async () => {
    const [n] = await withActorNames(db, null, [{ author_id: "s-lucy" }], "author_id", "author_name");
    expect(n.author_name).toBe("Lucy Park");
  });

  it("does nothing without rows", async () => {
    expect(await withActorNames(db, WS, [], "actor_id", "actor_name")).toEqual([]);
  });
});
