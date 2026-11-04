import { describe, expect, it } from "vitest";
import { actorLabel, changesOf, describeEffects, formatChange, pastOnly, type ActivityEvent } from "./ActivityTimeline";

describe("activity change values", () => {
  it("reads nested values instead of printing [object Object]", () => {
    expect(formatChange({ subject: "Payment plan offer", body: "Hi Brianna" })).toBe("Payment plan offer");
    expect(formatChange({ body: "Hi Brianna, we can split your balance into three payments." })).toBe("Hi Brianna, we can split your balance into three payments.");
    expect(formatChange([{ kind: "message" }, { kind: "task" }])).toBe("2 items");
    expect(formatChange([{ kind: "message" }])).toBe("1 item");
    expect(formatChange({ a: 1, b: 2 })).toBe("2 fields");
    expect(formatChange({ body: "y".repeat(100) })).toBe(`${"y".repeat(79)}…`);
  });

  it("keeps scalars as before", () => {
    expect(formatChange(null)).toBe("empty");
    expect(formatChange("")).toBe("empty");
    expect(formatChange(1500)).toBe("1,500");
    expect(formatChange("SMS")).toBe("SMS");
  });
});

const ev = (over: Partial<ActivityEvent>): ActivityEvent => ({ id: "e1", at: "2026-11-02T18:30:00Z", actor_kind: "agent", actor_id: "maintenance_triage", verb: "applied", summary: "Assign Metroplex Air & Heat to WO-13619", ...over });

describe("agent activity", () => {
  it("names the agent once", () => {
    expect(actorLabel(ev({ actor_id: "Maintenance Triage agent" }))).toBe("Maintenance Triage Agent");
    expect(actorLabel(ev({ actor_id: "maintenance_triage", actor_name: "maintenance triage agent" }))).toBe("Maintenance Triage Agent");
    expect(actorLabel(ev({ actor_id: "collections" }))).toBe("Collections Agent");
    expect(actorLabel(ev({ actor_kind: "staff", actor_id: "tom", actor_name: "Tom Alvarez" }))).toBe("Tom Alvarez");
  });

  it("describes effects in words instead of empty → 1 item, and leaves them out of the field changes", () => {
    const e = ev({ data: JSON.stringify({ before: null, after: { effects: [{ kind: "update", table: "work_orders", id: "WO-13619", changes: { status: "Assigned", vendor_id: "v06" } }] } }) });
    expect(changesOf(e)).toEqual([]);
    expect(describeEffects(e)).toEqual(["Status set to Assigned"]);
    expect(describeEffects(ev({ data: { after: { effects: [
      { kind: "message", party_kind: "resident", channel: "SMS", subject: "Rent reminder" },
      { kind: "task", title: "Review bill BILL-1" },
      { kind: "insert", table: "renewal_offers", row: {} },
      { kind: "update", table: "bills", id: "b1", changes: { approved_by: "$by", approved_at: "2026-11-04T00:00:00Z" } },
      { kind: "unknown" },
    ] } } }))).toEqual(["Sent a text to the resident: Rent reminder", "Created a task: Review bill BILL-1", "Recorded a renewal offer"]);
    expect(describeEffects(ev({ data: null }))).toEqual([]);
  });

  it("never shows a past event in the future", () => {
    const now = new Date("2026-11-04T00:30:00Z");
    expect(pastOnly("2026-11-04T00:51:07Z", now)).toBe(now.toISOString());
    expect(pastOnly("2026-11-03T10:00:00Z", now)).toBe("2026-11-03T10:00:00Z");
  });
});
