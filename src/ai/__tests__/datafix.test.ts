import { afterEach, describe, expect, it, vi } from "vitest";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import { get } from "../data";
import { applyFixes } from "../datafix";
import { DB_BUSY, publicError } from "../http";
import { fixProposal, queueReason } from "../tools/write";
import { setModelForTests } from "../providers";
import { DANIEL, MARCUS, openFixture, WS } from "./fixture";

afterEach(() => setModelForTests(undefined));

const actorOf = (id: string): Actor => {
  const p = getPersona(id)!;
  return { ...DANIEL, personaId: id, name: p.name, role: p.role };
};

// A "rent far above market" issue: its fix changes a lease's rent, so a person decides it in the inbox.
function setup() {
  setModelForTests(null);
  const f = openFixture();
  f.raw.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence, suggested_fix) VALUES ('base', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("di-rent", "leases.rent_outlier", "leases", "l1", "p01", "2026-11-01", "warn", '{"rent_cents":140000}', JSON.stringify({ changes: { rent_cents: 150000 }, why: ["Rent far above market"] }));
  return f;
}

async function apply(personaId: string, actor: Actor, ids: string[], safeOnly = false) {
  const f = setup();
  const data = { db: f.db, ws: WS, actor };
  const r = await applyFixes(data, getPersona(personaId)!, ids, { safeOnly });
  const decisions = f.raw.prepare("SELECT count(*) AS n FROM ai_decisions WHERE workspace_id = ?").get(WS) as { n: number };
  return { ...f, data, r, decisions: decisions.n };
}

describe("applying fixes from Data Health", () => {
  it("queues a money fix from a leasing agent instead of changing the rent", async () => {
    const { r, data, raw, decisions } = await apply("lena", actorOf("lena"), ["di-rent"]);
    expect(r.applied).toBe(0);
    expect(r.results[0]).toMatchObject({ ok: false, queued: true });
    expect(r.results[0].message).toMatch(/approvals inbox/);
    expect(raw.prepare("SELECT queue_state, assignee_role FROM ai_proposals WHERE workspace_id = ? AND id = ?").get(WS, r.results[0].proposalId!)).toMatchObject({ queue_state: "needs_you", assignee_role: "accountant" });
    expect(decisions).toBe(0);
    expect((await get(data, "leases", "l1"))?.rent_cents).toBe(140000);
  });

  it("queues a money fix even for roles that may approve it: Data Health never applies one directly", async () => {
    for (const id of ["daniel", "grace"]) {
      const { r, data, decisions } = await apply(id, actorOf(id), ["di-rent"]);
      expect(r.results[0]).toMatchObject({ ok: false, queued: true });
      expect(decisions).toBe(0);
      expect((await get(data, "leases", "l1"))?.rent_cents).toBe(140000);
    }
  });

  it("applies a low-risk fix for a role with write access", async () => {
    const { r, data, decisions } = await apply("marcus", MARCUS, ["di1"]);
    expect(r.results[0]).toMatchObject({ ok: true });
    expect(r.applied).toBe(1);
    expect(decisions).toBe(1);
    expect((await get(data, "data_issues", "di1"))?.status).not.toBe("open");
  });

  it("refuses a low-risk fix for a role without write access and leaves it queued", async () => {
    const { r, data, decisions } = await apply("lena", actorOf("lena"), ["di1"]);
    expect(r.results[0]).toMatchObject({ ok: false, queued: true });
    expect(r.results[0].message).toMatch(/can't act on/);
    expect(decisions).toBe(0);
    expect((await get(data, "properties", "p02"))?.street).toBe("123 MAIN STREET.");
  });

  it("bulk safe fixes: skip money fixes, apply low-risk ones only for a role that may", async () => {
    const ok = await apply("marcus", MARCUS, ["di1", "di-rent"], true);
    expect(ok.r.applied).toBe(1);
    expect(ok.r.results.find((x) => x.id === "di-rent")).toMatchObject({ ok: false });
    expect(ok.raw.prepare("SELECT count(*) AS n FROM ai_proposals WHERE workspace_id = ? AND entity_id = 'di-rent'").get(WS)).toMatchObject({ n: 0 });
    const refused = await apply("lena", actorOf("lena"), ["di1"], true);
    expect(refused.r.applied).toBe(0);
    expect(refused.decisions).toBe(0);
  });

  it("the page's button label follows the same rule: queued exactly when applying would queue", async () => {
    for (const [id, actor] of [["lena", actorOf("lena")], ["marcus", MARCUS], ["daniel", actorOf("daniel")]] as const) {
      for (const issue of ["di1", "di-rent"]) {
        const { r, raw } = await apply(id, actor, [issue]);
        const row = raw.prepare("SELECT * FROM data_issues WHERE id = ?").get(issue) as Record<string, unknown>;
        const fix = row.suggested_fix ? row : { ...row, suggested_fix: JSON.stringify({ changes: { street: "123 Main St" } }) };
        expect(queueReason(fixProposal(fix), actor.role) !== null).toBe(!r.results[0].ok);
      }
    }
  });

  it("masks database errors but not model-provider ones", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(publicError("D1_ERROR: D1 DB is overloaded. Requests queued for too long.")).toBe(DB_BUSY);
    expect(publicError("SQLITE_BUSY: database is locked")).toBe(DB_BUSY);
    expect(publicError("Anthropic API: overloaded_error")).toBe("Anthropic API: overloaded_error");
    expect(publicError("Already fixed")).toBe("Already fixed");
    quiet.mockRestore();
  });
});
