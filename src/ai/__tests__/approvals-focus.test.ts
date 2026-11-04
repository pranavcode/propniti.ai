import { describe, expect, it } from "vitest";
import { proposalFocus, proposalsPage } from "../views";
import { DANIEL, MARCUS, openFixture, WS } from "./fixture";

// Deep links into the approvals inbox (?proposal=<id> or ?record=<entity>/<id>) open the queue and
// page that hold the proposal, so it shows on the first screen even when it isn't on page 1.
function seed() {
  const { raw, db } = openFixture();
  const add = raw.prepare("INSERT INTO ai_proposals (workspace_id, id, agent, entity_type, entity_id, property_id, action, title, confidence, risk, queue_state, created_at) VALUES ('base', ?, 'leasing', ?, ?, ?, 'applications.decide', ?, 0.8, ?, 'needs_you', ?)");
  // 30 newer items fill page 1, so the application's proposal sorts onto page 2.
  for (let i = 0; i < 30; i++) add.run(`busy-${i}`, "leases", `l-${i}`, "p01", `Busy ${i}`, "Medium", `2026-11-03T10:${String(i).padStart(2, "0")}:00Z`);
  add.run("prop-app-old", "applications", "app-x", "p01", "Score app-x (first run)", "Medium", "2026-10-30T09:00:00Z");
  add.run("prop-app", "applications", "app-x", "p01", "Score app-x", "Medium", "2026-11-01T09:00:00Z");
  add.run("prop-atl", "applications", "app-atl", "p10", "Score app-atl", "Medium", "2026-11-02T09:00:00Z");
  add.run("prop-done", "applications", "app-done", "p01", "Score app-done", "Medium", "2026-11-02T09:00:00Z");
  raw.exec("INSERT INTO ai_decisions (workspace_id, id, proposal_id, decision, decided_by, decided_at) VALUES ('base', 'dec-1', 'prop-done', 'Approved', 'rachel', '2026-11-03T12:00:00Z')");
  return db;
}

describe("approvals inbox deep link", () => {
  it("finds the latest proposal for an application and the page it sits on", async () => {
    const data = { db: seed(), ws: WS, actor: DANIEL };
    const focus = await proposalFocus(data, { record: "applications/app-x" });
    expect(focus).toEqual({ id: "prop-app", queue: "needs_you", page: 2 });
    const page = await proposalsPage(data, { queue: focus!.queue, page: focus!.page });
    expect(page.rows.map((r) => r.id)).toContain("prop-app");
  });

  it("opens a proposal by id in the queue it belongs to", async () => {
    const data = { db: seed(), ws: WS, actor: DANIEL };
    expect(await proposalFocus(data, { proposal: "prop-done" })).toEqual({ id: "prop-done", queue: "decided", page: 1 });
    expect(await proposalFocus(data, { proposal: "nope" })).toBeNull();
    expect(await proposalFocus(data, { record: "applications/app-none" })).toBeNull();
    expect(await proposalFocus(data, { record: "not-a-record" })).toBeNull();
  });

  it("doesn't reveal a proposal outside the persona's properties", async () => {
    const db = seed();
    expect(await proposalFocus({ db, ws: WS, actor: MARCUS }, { record: "applications/app-atl" })).toBeNull();
    expect(await proposalFocus({ db, ws: WS, actor: MARCUS }, { proposal: "prop-atl" })).toBeNull();
    expect(await proposalFocus({ db, ws: WS, actor: DANIEL }, { proposal: "prop-atl" })).toMatchObject({ id: "prop-atl", queue: "needs_you" });
  });
});
