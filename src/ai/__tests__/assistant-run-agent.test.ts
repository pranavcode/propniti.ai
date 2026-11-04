import { afterEach, describe, expect, it } from "vitest";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import { ask } from "../assistant";
import { runNow } from "../orchestrator";
import { setModelForTests } from "../providers";
import { DANIEL, MARCUS, openFixture, WS } from "./fixture";

// Do mode: "run the collections agent" or "triage new work orders" starts the agent the way Run now
// does (same permission check), links the live run, and doesn't start a second run while one is going.

afterEach(() => setModelForTests(undefined));

const resident = getPersona("resident")!;
const RESIDENT: Actor = { personaId: "resident", name: resident.name, role: "resident", scope: resident.scope, propertyIds: ["p01"] };
const runs = (raw: ReturnType<typeof openFixture>["raw"], agent: string) => (raw.prepare("SELECT count(*) AS n FROM agent_runs WHERE workspace_id = ? AND agent_key = ?").get(WS, agent) as { n: number }).n;

describe("starting agents from the assistant", () => {
  it("starts the agent for a staff role and links the live run", async () => {
    setModelForTests(null);
    const { db, raw } = openFixture();
    const pending: Promise<unknown>[] = [];
    const r = await ask({ data: { db, ws: WS, actor: MARCUS }, persona: getPersona("marcus")!, question: "Run the collections agent", waitUntil: (p) => void pending.push(p) });
    await Promise.all(pending);
    expect(r.mode).toBe("actions");
    expect(r.answer).toBe("Started the Collections agent. Watch the run below; anything it proposes waits for approval.");
    expect(r.run).toMatchObject({ agent: "collections", label: "Collections agent", already: false });
    expect(r.citations).toContainEqual({ label: "Watch the run", href: `/app/ai/runs/${r.run!.id}` });
    expect(r.proposals).toEqual([]);
    expect(runs(raw, "collections")).toBe(1);
    expect(raw.prepare("SELECT started_by, trigger_kind FROM agent_runs WHERE id = ?").get(r.run!.id)).toMatchObject({ started_by: "marcus", trigger_kind: "manual" });
  });

  it("maps 'triage new work orders' to the maintenance triage agent", async () => {
    setModelForTests(null);
    const { db, raw } = openFixture();
    const r = await ask({ data: { db, ws: WS, actor: DANIEL }, persona: getPersona("daniel")!, question: "Triage new work orders" });
    expect(r.run).toMatchObject({ agent: "maintenance_triage" });
    expect(runs(raw, "maintenance_triage")).toBe(1);
  });

  it("refuses politely for a portal persona and starts nothing", async () => {
    setModelForTests(null);
    const { db, raw } = openFixture();
    const r = await ask({ data: { db, ws: WS, actor: RESIDENT }, persona: resident, question: "Run the collections agent" });
    expect(r.answer).toMatch(/^I can't start the Collections agent for you: only staff can run agents\./);
    expect(r.run).toBeUndefined();
    expect(runs(raw, "collections")).toBe(0);
  });

  it("doesn't start a second run while one is still going", async () => {
    setModelForTests(null);
    const { db, raw } = openFixture();
    const s = { db, ws: WS, actor: MARCUS, persona: getPersona("marcus")! };
    const first = await runNow(s, "collections");
    if (!first.ok) throw new Error(first.error);
    // Still running (the background part hasn't finished): a repeat links the same run.
    raw.prepare("UPDATE agent_runs SET status = 'running', ended_at = NULL WHERE id = ?").run(first.runId);
    const again = await ask({ data: { db, ws: WS, actor: MARCUS }, persona: s.persona, question: "Run the collections agent" });
    expect(again.run).toMatchObject({ id: first.runId, already: true });
    expect(again.answer).toMatch(/^The Collections agent is already running/);
    expect(runs(raw, "collections")).toBe(1);
    // Once it has finished, a new request starts a new run.
    await first.done;
    raw.prepare("UPDATE agent_runs SET status = 'done' WHERE id = ?").run(first.runId);
    const next = await runNow(s, "collections");
    expect(next).toMatchObject({ ok: true, already: false });
    expect(runs(raw, "collections")).toBe(2);
  });

  it("Run now follows the same rules", async () => {
    const { db } = openFixture();
    expect(await runNow({ db, ws: WS, actor: RESIDENT, persona: resident }, "collections")).toMatchObject({ ok: false, status: 403 });
    expect(await runNow({ db, ws: WS, actor: MARCUS, persona: getPersona("marcus")! }, "nope")).toMatchObject({ ok: false, status: 404 });
  });

  it("still drafts reminders when asked to send them", async () => {
    setModelForTests(null);
    const { db } = openFixture();
    const r = await ask({ data: { db, ws: WS, actor: MARCUS }, persona: getPersona("marcus")!, question: "Send reminders to residents 30+ days late" });
    expect(r.run).toBeUndefined();
    expect(r.proposals.length).toBe(2);
  });
});
