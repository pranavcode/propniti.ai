import { describe, expect, it } from "vitest";
import { getEntity } from "@/entities";
import "@/extensions";
import { bulkActions } from "./spec";

const def = (k: string) => getEntity(k)!;

describe("bulk actions on lists", () => {
  it("label each button with the action's own label, not its key", () => {
    expect(bulkActions(def("work_orders"), "maintenance_supervisor")).toContainEqual(expect.objectContaining({ key: "work_orders.check_photos", label: "Run photo check" }));
    expect(bulkActions(def("bills"), "accountant").find((a) => a.key === "bills.approve")).toMatchObject({ label: "Approve", confirm: expect.stringContaining("payable") });
  });

  it("include any one-click action marked bulk, and never money or input actions", () => {
    const keys = (k: string, role: Parameters<typeof bulkActions>[1]) => bulkActions(def(k), role).map((a) => a.key);
    expect(keys("listings", "property_manager")).toEqual(expect.arrayContaining(["listings.publish", "listings.pause"]));
    expect(keys("late_fee_policies", "property_manager")).not.toContain("late_fee_policies.post_late_fees");
    expect(keys("bank_transactions", "accountant")).not.toContain("bank_transactions.match");
  });

  it("drop actions the role can't run", () => {
    expect(bulkActions(def("work_orders"), "leasing_agent").map((a) => a.key)).not.toContain("work_orders.check_photos");
  });
});
