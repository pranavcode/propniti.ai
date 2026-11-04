import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { getEntity } from "@/entities";

// Record titles and subtitles say each thing once.
describe("record labels", () => {
  it("names a payment by its reference, without repeating the method", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE payments (id TEXT, method TEXT, reference TEXT)");
    const ins = db.prepare("INSERT INTO payments VALUES (?, ?, ?)");
    ins.run("pay-1", "ACH", "ACH 41458948");
    ins.run("pay-2", "Check", "1042");
    ins.run("pay-3", "Card", "");
    const sql = getEntity("payments")!.fields.label!.sql!;
    const rows = db.prepare(`SELECT ${sql} AS label FROM payments ORDER BY id`).all() as { label: string }[];
    expect(rows.map((r) => r.label)).toEqual(["ACH 41458948", "Check · 1042", "Card · pay-3"]);
  });

  it("names a work order's unit once, not its property and then the unit carrying the property's name", () => {
    const sub = getEntity("work_orders")!.subtitle!;
    expect(sub({ id: "WO-13618", property_id__label: "Frisco Station Townhomes", unit_id__label: "Frisco Station Townhomes #J5" })).toBe("WO-13618 · Frisco Station Townhomes #J5");
    expect(sub({ id: "WO-13155", property_id__label: "Lakewood Gardens", unit_id__label: null })).toBe("WO-13155 · Lakewood Gardens");
  });

  it("names an inspection's unit once", () => {
    const sub = getEntity("inspections")!.subtitle!;
    expect(sub({ property_id__label: "Barton Creek Commons", unit_id__label: "Barton Creek Commons #7103", scheduled_on: "2026-11-10" })).toBe("Barton Creek Commons #7103 · 2026-11-10");
  });
});
