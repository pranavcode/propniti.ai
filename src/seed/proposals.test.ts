import "@/entities";
import "@/ai/actions";
import { beforeAll, describe, expect, it } from "vitest";
import { isAiAction } from "@/ai/action-keys";
import { Payload, executeProposal } from "@/ai/effects";
import type { Actor } from "@/entities/types";
import { getAction } from "@/extensions/actions";
import { openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { randomId } from "@/server/repo";
import { resolveWorkspace } from "@/server/workspace";
import { baseData } from "@/server/base";

// Every seeded agent proposal must be approvable: its action is registered, and its payload is what
// that action runs (explicit effects for AI-only actions, a valid input for registered ones).
const T = baseData().tables;
const daniel: Actor = { personaId: "daniel", name: "Daniel Reyes", role: "principal", scope: { kind: "org", label: "All" }, propertyIds: "all" };
let db: Db;
beforeAll(() => {
  db = openSqlite(":memory:");
}, 240_000);

describe("seeded AI proposals", { timeout: 240_000 }, () => {
  it("name a registered action, with a payload that action accepts", () => {
    const issues = new Set(T.data_issues.map((i) => i.id));
    for (const p of T.ai_proposals) {
      const key = String(p.action);
      const a = getAction(key as never);
      expect(a, `${p.id} ${key}`).toBeTruthy();
      const payload = JSON.parse(p.payload as string);
      if (isAiAction(key)) {
        const parsed = Payload.safeParse(payload);
        expect(parsed.success, `${p.id} ${key} effects`).toBe(true);
        if (key === "data_issues.apply_fix") expect(issues.has(payload.issue_id), `${p.id} issue`).toBe(true);
        else expect(parsed.data!.effects.length, `${p.id} ${key} has no effects`).toBeGreaterThan(0);
      } else if (a!.input) expect(a!.input.safeParse(payload.input ?? payload).success, `${p.id} ${key} input`).toBe(true);
    }
    expect(T.ai_proposals.some((p) => String(p.action).startsWith("households."))).toBe(false);
  });

  it("approve for real: one waiting proposal per action runs without a missing handler or bad payload", async () => {
    const ws = randomId();
    await resolveWorkspace(db, new Request("http://x", { headers: { cookie: `pn_ws=${ws}` } }), Date.now(), true, false);
    const waiting = T.ai_proposals.filter((p) => p.queue_state === "needs_you");
    const firstPer = [...new Map(waiting.map((p) => [p.action as string, p])).values()];
    expect(firstPer.length).toBeGreaterThan(6);
    let ok = 0;
    for (const p of firstPer) {
      const r = await executeProposal({ db, ws, actor: daniel }, p, { id: "daniel", name: "Daniel Reyes", role: "principal" });
      // A stale record (409) is a legitimate refusal; a missing handler or invalid payload is not.
      expect(r.message, `${p.action}: ${r.message}`).not.toMatch(/No handler|isn't a registered|invalid|Expected|Required/i);
      if (!r.ok) expect(r.status, `${p.action}: ${r.message}`).toBe(409);
      else ok++;
    }
    expect(ok, "most sample approvals should run").toBeGreaterThanOrEqual(firstPer.length - 2);
  });
});
