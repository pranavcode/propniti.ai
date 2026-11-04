import "@/entities";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import { openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { resolveActor } from "@/server/permissions";
import { ask } from "../assistant";
import { setModelForTests } from "../providers";
import { proposalsPage } from "../views";

// "What needs my approval?" answers with the persona's own Needs you tab: the decide rule for their
// role (decidableSql), their scope, and the approvals page's count, not every open proposal.

let db: Db;
beforeAll(() => {
  setModelForTests(null);
  db = openSqlite(":memory:");
}, 240_000);
afterAll(() => setModelForTests(undefined));

describe("approvals answer", { timeout: 240_000 }, () => {
  it("counts what each persona's Needs you tab shows", async () => {
    const counts: Record<string, number> = {};
    let n = 0;
    for (const id of ["daniel", "priya", "marcus", "lena", "rachel", "grace", "tom"]) {
      const persona = getPersona(id)!;
      const ws = `approvals-answer-${String(++n).padStart(12, "0")}`;
      await db.prepare("INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES (?, 'demo', 0, 0)").bind(ws).run();
      const data = { db, ws, actor: await resolveActor(db, persona, ws) };
      const page = await proposalsPage(data, { queue: "needs_you", size: 5 });
      const r = await ask({ data, persona, question: "What needs my approval today?" });
      if (!page.total) expect(r.answer, id).toBe("Nothing is waiting for your decision.");
      else {
        expect(r.answer, id).toMatch(new RegExp(`^${page.total} items? wait for your decision in Needs you\\. First in the list: `));
        expect(r.answer, id).toContain(String(page.rows[0].title));
      }
      expect(r.trace.map((t) => t.tool), id).toEqual(["approvals.needs_you"]);
      counts[id] = page.total;
    }
    // The rule really differs by role and scope (one shared number was the bug).
    expect(new Set(Object.values(counts)).size, JSON.stringify(counts)).toBeGreaterThan(3);
    expect(counts.marcus).toBeLessThan(counts.daniel);
  });
});
