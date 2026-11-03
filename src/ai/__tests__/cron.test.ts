import { describe, expect, it } from "vitest";
import { dueBetween, nextRun, parseCron } from "../cron";
import { sweep } from "../orchestrator";
import { setModelForTests } from "../providers";
import { openFixture, WS } from "./fixture";

describe("cron schedules", () => {
  it("rejects values outside each field's range, reversed ranges and junk", () => {
    for (const bad of ["0-2000000 * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 7", "5-2 * * * *", "*/0 * * * *", "1/2/3 * * * *", "a * * * *", "-1 * * * *", "* * * *"]) {
      expect(() => parseCron(bad), bad).toThrow();
    }
    expect(parseCron("*/15 9-17 * * 1-5").m.size).toBe(4);
    expect(nextRun("0-2000000 * * * *", Date.now())).toBeNull();
  });

  it("checks a day of minutes quickly", () => {
    const t0 = Date.now();
    expect(dueBetween("0 14 * * *", Date.parse("2026-11-03T14:30:00Z"), Date.parse("2026-11-04T14:00:30Z"))).toBe(true);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it("a malicious saved schedule is skipped and the sweep stays fast", async () => {
    setModelForTests(null);
    const { raw, db } = openFixture();
    const at = Date.parse("2026-11-04T14:00:30Z");
    raw.prepare("UPDATE workspaces SET last_seen_at = ? WHERE id = ?").run(at - 60_000, WS);
    raw.prepare("INSERT INTO agent_definitions (workspace_id, id, name, owner_role, goal, tools, triggers, autonomy) VALUES (?, 'collections', 'Collections agent', 'property_manager', 'x', '[]', ?, 'act_with_approval')").run(WS, JSON.stringify({ schedule: "0-2000000 * * * *" }));
    const t0 = Date.now();
    const report = await sweep(db, at);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(report!.scheduled.map((s) => s.agent)).not.toContain("collections");
    setModelForTests(undefined);
  });
});
