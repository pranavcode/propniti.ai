import { describe, expect, it } from "vitest";
import { getEntity } from "@/entities";
import { writeSchema } from "@/server/query";

// Late-fee policies are generic records, so their bounds live in the field schemas.
describe("late-fee policy bounds", () => {
  const def = getEntity("late_fee_policies")!;
  const ok = { kind: "Flat", grace_days: 3, flat: 50 };

  it.each(["create", "update"] as const)("refuses out-of-range values on %s", (mode) => {
    const s = writeSchema(def, "accountant", mode);
    expect(s.safeParse(ok).success).toBe(true);
    for (const bad of [{ pct: 26 }, { pct: -1 }, { grace_days: 32 }, { grace_days: -1 }, { grace_days: 2.5 }, { flat: -5 }, { daily: -1 }, { max: -1 }, { flat: 1_000_000 }])
      expect(s.safeParse({ ...ok, ...bad }).success, JSON.stringify(bad)).toBe(false);
    expect(s.safeParse({ ...ok, kind: "Percent", pct: 25, max: 150 }).success).toBe(true);
    // No maximum stays allowed (the seeded org and Texas policies have none): each value is capped
    // and a fee posts once per lease per month, so the fee can't run away.
    expect(s.safeParse({ ...ok, kind: "Flat + daily", daily: 100, max: null }).success).toBe(true);
    expect(s.safeParse({ ...ok, daily: 101 }).success).toBe(false);
  });
});
