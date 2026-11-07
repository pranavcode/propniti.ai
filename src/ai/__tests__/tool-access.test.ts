import { afterEach, describe, expect, it, vi } from "vitest";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { ask } from "../assistant";
import { setModelForTests } from "../providers";
import { getTool } from "../tools/registry";
import type { RunContext } from "../types";
import { MARCUS, openFixture, WS } from "./fixture";

const platform: { db?: Db } = {};
vi.mock("@/lib/platform", () => ({ getPlatform: () => platform }));

// The ledger and metrics tools read charges and journal entries with SQL of their own, so they
// check the caller's read permission on those entities, as the entity API does. A leasing agent
// asking who owes rent once got every late resident's name, unit and balance.

const LENA: Actor = { personaId: "lena", name: "Lena Ortiz", role: "leasing_agent", scope: { kind: "property", ids: ["p01", "p02", "p03"], label: "3 Austin properties" }, propertyIds: ["p01", "p02", "p03"] };
const RACHEL: Actor = { personaId: "rachel", name: "Rachel Moore", role: "broker", scope: { kind: "org", label: "All" }, propertyIds: "all" };

afterEach(() => setModelForTests(undefined));

describe("AI read tools follow entity read permissions", () => {
  it("refuse rent balances and NOI to roles that can't read charges or journal entries", async () => {
    setModelForTests(null);
    const { db } = openFixture();
    for (const actor of [LENA, RACHEL]) {
      const persona = getPersona(actor.personaId)!;
      const owed = await ask({ data: { db, ws: WS, actor }, persona, question: "Which residents owe the most rent right now?" });
      expect(owed.answer, actor.role).toMatch(/You don't have access to charges/);
      expect(owed.answer, actor.role).not.toMatch(/Jordan|Ruiz|Okoro|\$\d/);
      const noi = await ask({ data: { db, ws: WS, actor }, persona, question: "Why did NOI change last month?" });
      expect(noi.answer, actor.role).toMatch(/You don't have access to journal entries/);
    }
  });

  it("still answer for a role that can read them", async () => {
    setModelForTests(null);
    const { db } = openFixture();
    const r = await ask({ data: { db, ws: WS, actor: MARCUS }, persona: getPersona("marcus")!, question: "Which residents owe the most rent right now?" });
    expect(r.answer).toMatch(/Lee|Ruiz/);
  });

  it("keep occupancy for leasing staff without the money columns, and refuse money KPI explanations", async () => {
    setModelForTests(null);
    const { db } = openFixture();
    const data = { db, ws: WS, actor: LENA };
    const vacant = await ask({ data, persona: getPersona("lena")!, question: "What units are vacant?" });
    expect(vacant.answer).toMatch(/Economic occupancy/);
    const m = (await getTool("metrics.monthly")!.run({ data } as unknown as RunContext, { months: 3 })) as { rows: Record<string, unknown>[] };
    expect(m.rows.length).toBeGreaterThan(0);
    expect(Object.keys(m.rows[0]).filter((k) => k.endsWith("_cents"))).toEqual([]);
    expect(m.rows[0]).toHaveProperty("occupancy_econ");

    platform.db = db;
    const route = await import("@/app/(app)/app/portfolio/explain/route");
    const post = (metric: string) => route.POST(new Request("http://x/app/portfolio/explain", { method: "POST", body: JSON.stringify({ metric }), headers: { origin: "http://x", host: "x", "cf-connecting-ip": `t-${Math.random()}`, cookie: `pn_as=lena; pn_ws=${WS}` } }));
    expect((await post("portfolio.noi")).status).toBe(403);
    expect((await post("portfolio.occupancy")).status).toBe(200);
  });
});
