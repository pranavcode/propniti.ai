import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "@/entities/types";
import { effective, LAKESIDE_BASE, LAKESIDE_WS } from "@/server/effective";
import { sql } from "../data";
import { emitDueEvents, startRun } from "../orchestrator";
import { setModelForTests } from "../providers";
import { generateBriefing } from "../summaries";
import { dataHealth, issuesPage, proposalsPage, runsPage } from "../views";
import { DANIEL, openFixture, WS } from "./fixture";
import "../agents";

// The AI layer keeps the two demo orgs apart: agents run per org, and a Lakeside persona's
// proposals, data issues, runs, briefings, summaries and sample conversations never include
// Summit's (the fixture's base), and Summit never sees what ran in Lakeside.

afterEach(() => setModelForTests(undefined));

const LK = WS + LAKESIDE_WS;
const ALEX: Actor = { personaId: "alex", name: "Alex Morgan", role: "principal", scope: { kind: "org", label: "New company, no data yet" }, propertyIds: "all" };
const AGENTS = ["collections", "renewals", "maintenance_triage", "ap", "data_health", "compliance", "owner_reporting"] as const;

function open() {
  const f = openFixture();
  f.raw.exec(`INSERT INTO workspaces (id, kind, created_at, last_seen_at) VALUES ('${LAKESIDE_BASE}', 'org', 0, 0), ('${LK}', 'demo', 0, ${Date.now()})`);
  f.raw.exec("INSERT INTO ai_summaries (workspace_id, id, entity_type, entity_id, summary, model, generated_at) VALUES ('base', 'sum1', 'properties', 'p01', 'The Lofts at Riverside is 95% occupied.', 'rules', '2026-11-04')");
  f.raw.exec("INSERT INTO assistant_threads (workspace_id, id, user_id, title, created_at, updated_at) VALUES ('base', 'th1', 'alex', 'Sample: who is late?', '2026-11-04', '2026-11-04')");
  f.raw.exec("INSERT INTO notifications (workspace_id, id, user_id, channel, title, at) VALUES ('base', 'n1', 'alex', 'In-app', 'Rent due', '2026-11-04')");
  return f;
}

describe("agents and the AI data layer, per org", () => {
  it("runs every agent in Lakeside without proposing on Summit's records", async () => {
    setModelForTests(null);
    const { raw, db } = open();
    for (const agent of AGENTS) {
      const r = await (await startRun({ db, ws: LK, actor: ALEX, agent, trigger: { kind: "manual" } })).done;
      expect(raw.prepare("SELECT count(*) AS n FROM ai_proposals WHERE run_id = ?").get(r.runId), agent).toEqual({ n: 0 });
    }
    // The same agents do find work in Summit's data.
    const summit = await (await startRun({ db, ws: WS, actor: DANIEL, agent: "collections", trigger: { kind: "manual" } })).done;
    expect((raw.prepare("SELECT count(*) AS n FROM ai_proposals WHERE run_id = ?").get(summit.runId) as { n: number }).n).toBeGreaterThan(0);
    // Date-driven events come only from the org's own leases and charges.
    await emitDueEvents(db, LK);
    expect(raw.prepare("SELECT count(*) AS n FROM events WHERE workspace_id = ?").get(LK)).toEqual({ n: 0 });
  });

  it("shows Lakeside no Summit proposals, data issues, runs, summaries, conversations or notifications, and the other way round", async () => {
    setModelForTests(null);
    const { db } = open();
    const summitRun = await (await startRun({ db, ws: WS, actor: DANIEL, agent: "collections", trigger: { kind: "manual" } })).done;
    const lakeRun = await (await startRun({ db, ws: LK, actor: ALEX, agent: "data_health", trigger: { kind: "manual" } })).done;
    const lake = { db, ws: LK, actor: ALEX };
    const summit = { db, ws: WS, actor: DANIEL };

    expect((await proposalsPage(lake, {})).rows).toEqual([]);
    expect((await issuesPage(lake, {})).rows).toEqual([]);
    expect((await dataHealth(lake)).open).toBe(0);
    expect((await runsPage(lake, {})).rows.map((r) => r.id)).toEqual([lakeRun.runId]);
    expect((await runsPage(summit, {})).rows.map((r) => r.id)).not.toContain(lakeRun.runId);
    expect((await runsPage(summit, {})).rows.map((r) => r.id)).toContain(summitRun.runId);
    for (const t of ["properties", "vendors", "owners", "work_orders", "bills", "ai_summaries", "assistant_threads", "data_issues", "ai_proposals"]) {
      expect((await sql<{ n: number }>(lake, `SELECT count(*) AS n FROM {${t}}`))[0]!.n, t).toBe(0);
    }
    for (const t of ["notifications", "metrics_monthly"]) expect(await db.prepare(`SELECT count(*) AS n FROM ${effective(t)}`).bind(LK).first(), t).toEqual({ n: 0 });
    // Reference data is shared: help, data rules and the org-default policies.
    expect((await sql<{ n: number }>(lake, "SELECT count(*) AS n FROM {help_articles}"))[0]!.n).toBeGreaterThan(0);
    expect((await sql<{ n: number }>(lake, "SELECT count(*) AS n FROM {data_rules}"))[0]!.n).toBeGreaterThan(0);
  });

  it("writes Lakeside's briefing from Lakeside's data only", async () => {
    setModelForTests(null);
    const { db } = open();
    const b = await generateBriefing({ db, ws: LK, actor: ALEX }, "alex");
    expect(JSON.stringify(b)).not.toMatch(/Riverside|Barton Creek|Lone Star|Hill Country|HCG-881/);
  });
});
