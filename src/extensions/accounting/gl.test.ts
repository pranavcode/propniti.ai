import { beforeEach, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import type { Db } from "@/lib/platform/types";
import { actorFor } from "@/server/permissions";
import { emptyDb, seed } from "@/server/query.fixture";
import { getRow } from "@/server/query";

// Cash (1000) is a header account: rent, deposits and payouts post to its sub-accounts 1010 and
// 1020. Its year-to-date activity is theirs plus its own.
let db: Db;
beforeEach(async () => {
  db = emptyDb();
  await seed(db);
  await db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('as_of', '2026-11-04')").run();
  for (const [id, number, name, parent] of [["gl-1000", "1000", "Cash", null], ["gl-1010", "1010", "Cash — operating trust", "gl-1000"], ["gl-1020", "1020", "Cash — security deposits", "gl-1000"]])
    await db.prepare("INSERT INTO gl_accounts (workspace_id, id, number, name, type, parent_id) VALUES ('base', ?, ?, ?, 'Asset', ?)").bind(id, number, name, parent).run();
  for (const [id, gl, period, dr, cr] of [["je1", "gl-1010", "2026-10", 500_00, 0], ["je2", "gl-1010", "2026-10", 0, 120_00], ["je3", "gl-1020", "2026-09", 900_00, 0], ["je4", "gl-1010", "2025-12", 7_00, 0]] as const)
    await db.prepare("INSERT INTO journal_entries (workspace_id, id, property_id, owner_entity_id, gl_account_id, period, debit_cents, credit_cents) VALUES ('base', ?, 'p01', 'oe01', ?, ?, ?, ?)").bind(id, gl, period, dr, cr).run();
});

describe("chart of accounts", () => {
  it("rolls a header account's year-to-date activity up from its sub-accounts", async () => {
    const ctx = { db, ws: null, actor: await actorFor(db, null, getPersona("daniel")!) };
    expect((await getRow(ctx, "gl_accounts", "gl-1000"))!.ytd).toBe(1280);
    expect((await getRow(ctx, "gl_accounts", "gl-1010"))!.ytd).toBe(380);
    expect((await getRow(ctx, "gl_accounts", "gl-1020"))!.ytd).toBe(900);
  });
});
