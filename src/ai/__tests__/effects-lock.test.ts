import { describe, expect, it } from "vitest";
import "@/entities";
import { get } from "../data";
import { executeProposal } from "../effects";
import { DANIEL, openFixture, WS } from "./fixture";

// Review: an approved proposal could reassign a work order that had since been invoiced or completed,
// which a generic edit refuses (EntityDef.lockedWhen).
function proposal(f: ReturnType<typeof openFixture>, id: string, woId: string) {
  const payload = JSON.stringify({ effects: [{ kind: "update", table: "work_orders", id: woId, changes: { vendor_id: "v01", status: "Assigned" } }] });
  f.raw.prepare("INSERT INTO ai_proposals (workspace_id, id, agent, action, entity_type, entity_id, property_id, title, payload, risk, confidence, queue_state, created_at) VALUES (?, ?, 'maintenance', 'work_orders.reassign', 'work_orders', ?, 'p01', 'Reassign to Lone Star', ?, 'Low', 0.9, 'needs_you', '2026-11-04T08:00:00Z')").run(WS, id, woId, payload);
  return f.raw.prepare("SELECT * FROM ai_proposals WHERE workspace_id = ? AND id = ?").get(WS, id) as Record<string, unknown>;
}

describe("proposal record updates and lockedWhen", () => {
  it("refuses to change a work order that is now locked, and still updates an open one", async () => {
    const f = openFixture();
    const data = { db: f.db, ws: WS, actor: DANIEL };
    const by = { id: "daniel", name: "Daniel Reyes" };
    expect(await executeProposal(data, proposal(f, "prop-locked", "WO-9001"), by)).toMatchObject({ ok: false, message: expect.stringMatching(/Completed now/) });
    expect(await get(data, "work_orders", "WO-9001")).toMatchObject({ status: "Completed" });
    expect(await executeProposal(data, proposal(f, "prop-open", "WO-10001"), by)).toMatchObject({ ok: true });
    expect(await get(data, "work_orders", "WO-10001")).toMatchObject({ status: "Assigned", vendor_id: "v01" });
  });
});
