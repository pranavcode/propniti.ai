import { describe, expect, it } from "vitest";
import { getEntity } from "@/entities";
import "@/extensions";
import { bulkActions, parentValues } from "./spec";

const def = (k: string) => getEntity(k)!;

describe("bulk actions on lists", () => {
  it("label each button with the action's own label, not its key", () => {
    expect(bulkActions(def("work_orders"), "maintenance_supervisor")).toContainEqual(expect.objectContaining({ key: "work_orders.check_photos", label: "Run photo check" }));
    expect(bulkActions(def("bills"), "accountant").find((a) => a.key === "bills.approve")).toMatchObject({ label: "Approve", confirm: expect.stringContaining("payable") });
  });

  it("include any one-click action marked bulk, and never money or input actions", () => {
    const keys = (k: string, role: Parameters<typeof bulkActions>[1]) => bulkActions(def(k), role).map((a) => a.key);
    expect(keys("renters_insurance", "property_manager")).toContain("renters_insurance.send_reminder");
    expect(keys("late_fee_policies", "property_manager")).not.toContain("late_fee_policies.post_late_fees");
    expect(keys("bank_transactions", "accountant")).not.toContain("bank_transactions.match");
  });

  it("drop actions the role can't run", () => {
    expect(bulkActions(def("work_orders"), "leasing_agent").map((a) => a.key)).not.toContain("work_orders.check_photos");
  });
});

describe("new record from a parent's tab", () => {
  it("fills the link to the parent and the references the two share", () => {
    const unit = { id: "p01-u1", property_id: "p01", unit_type_id: "ut1" };
    expect(parentValues(def("units"), unit, def("work_orders"), "unit_id", "p01-u1")).toEqual({ unit_id: "p01-u1", property_id: "p01" });
  });

  it("fills a property's id into its children", () => {
    expect(parentValues(def("properties"), { id: "p03" }, def("work_orders"), "property_id", "p03")).toEqual({ property_id: "p03" });
  });
});
