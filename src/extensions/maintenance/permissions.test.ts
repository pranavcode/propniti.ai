import { describe, expect, it } from "vitest";
import { can, getEntity } from "@/entities";
import { writeSchema } from "@/server/query";

// Vendors work on their own jobs only through named actions; amounts and status stay with staff.
describe("work order write permissions", () => {
  const def = getEntity("work_orders")!;

  it("gives vendors no generic edit of work orders", () => {
    expect(can("vendor", "update", "work_orders")).toBe(false);
    expect(can("vendor", "create", "work_orders")).toBe(false);
  });

  it("lets vendors accept, decline, add photos and submit an invoice, but never pay or dispatch", () => {
    for (const a of ["work_orders.vendor_accept", "work_orders.vendor_decline", "work_orders.add_photo", "work_orders.submit_invoice"] as const) expect(can("vendor", a, "work_orders")).toBe(true);
    for (const a of ["work_orders.approve_and_pay", "work_orders.dispatch", "work_orders.set_status", "work_orders.run_triage"] as const) expect(can("vendor", a, "work_orders")).toBe(false);
  });

  it("keeps estimate, status and SLA out of reach for roles that aren't maintenance staff", () => {
    expect(can("leasing_agent", "update", "work_orders")).toBe(false);
    expect(Object.keys(writeSchema(def, "vendor", "update").shape)).not.toEqual(expect.arrayContaining(["status"]));
    expect(Object.keys(writeSchema(def, "vendor", "update").shape)).not.toContain("estimate");
    const created = Object.keys(writeSchema(def, "leasing_agent", "create").shape);
    expect(created).toContain("status");
    expect(created).not.toContain("estimate");
    const sup = Object.keys(writeSchema(def, "maintenance_supervisor", "update").shape);
    expect(sup).toEqual(expect.arrayContaining(["status", "estimate", "cost", "vendor_id", "sla_due_at"]));
  });

  it("only staff approve and pay", () => {
    expect(can("maintenance_supervisor", "work_orders.approve_and_pay", "work_orders")).toBe(true);
    expect(can("leasing_agent", "work_orders.approve_and_pay", "work_orders")).toBe(false);
    expect(can("resident", "work_orders.approve_and_pay", "work_orders")).toBe(false);
  });
});

describe("vendor bank details", () => {
  it("can't be set or changed through generic writes by any role", () => {
    const def = getEntity("vendors")!;
    for (const role of ["accountant", "principal", "maintenance_supervisor", "vendor"] as const) {
      expect(Object.keys(writeSchema(def, role, "update").shape)).not.toContain("bank_last4");
      expect(Object.keys(writeSchema(def, role, "create").shape)).not.toContain("bank_last4");
    }
  });
});
