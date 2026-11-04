import { describe, expect, it } from "vitest";
import { getEntity } from "@/entities";
import type { Facts } from "@/entities/types";
import { rulesSummary } from "../summaries";
import { unknownNumbers } from "../rules";

// The rules summary is what a record shows when no model summary matches its current figures.
// It reads as plain sentences: names, not ids or snake_case keys, and only the facts' figures.
const say = (entity: string, facts: Facts) => {
  const text = getEntity(entity)!.ai!.rulesSummary!(facts);
  expect(unknownNumbers(text, facts)).toEqual([]);
  expect(text).not.toMatch(/_/);
  return text;
};

describe("rules summaries per entity", () => {
  it("work orders", () => {
    expect(say("work_orders", { work_order: "WO-13619", title: "AC not cooling", status: "Completed", priority: "Normal", trade: "HVAC", past_sla: false, age_days: 1, vendor: "Metroplex Air & Heat", estimate: 970, cost: 924, where: "Frisco Station Townhomes #J1" }))
      .toBe("Completed HVAC job at Frisco Station Townhomes #J1 by Metroplex Air & Heat, normal priority, finished within SLA after 1 day. Cost $924.");
    expect(say("work_orders", { work_order: "WO-10472", title: "Heater blowing cold air", status: "New", priority: "Urgent", trade: "HVAC", past_sla: false, age_days: 0, vendor: null, estimate: 855, cost: null, where: "The Lofts at Riverside #101" }))
      .toBe("Urgent HVAC job at The Lofts at Riverside #101, new and not yet assigned. Opened today, within SLA. Estimate $855.");
    expect(say("work_orders", { work_order: "WO-1", title: "Leak", status: "Assigned", priority: "Emergency", trade: "Plumbing", past_sla: true, age_days: 3, vendor: "Lone Star Plumbing", estimate: null, cost: null, where: "Barton Creek Commons" }))
      .toBe("Emergency Plumbing job at Barton Creek Commons, assigned to Lone Star Plumbing. Open 3 days, past its SLA.");
  });

  it("leases", () => {
    expect(say("leases", { lease: "Hill household · #903", status: "Active", start: "2026-02-12", end: "2027-02-11", rent: 2355, market_rent: 2260, balance: 0, residents: 1, days_to_end: 99 }))
      .toBe("Active lease for Hill household · #903, Feb 12 to Feb 11, 2027, at $2,355 a month (market $2,260). 1 resident on the lease. No balance owed. It ends in 99 days.");
    expect(say("leases", { lease: "Reyes household · #302", status: "Active", start: "2025-11-01", end: null, rent: 1775, market_rent: 1775, balance: 1200, residents: 2, days_to_end: null }))
      .toBe("Active lease for Reyes household · #302, Nov 1, 2025 to month to month, at $1,775 a month. 2 residents on the lease. $1,200 is owed.");
  });

  it("states money as the facts panel does: cents when there are any, whole dollars otherwise", () => {
    expect(say("residents", { resident: "Jordan Lee", status: "Current", unit: "#412", balance: 1234.56, lease_end: null, risk_score: null, autopay: true, nsf_payments: 0 }))
      .toBe("Jordan Lee in #412 is a current resident. Owes $1,234.56. On autopay.");
    expect(say("bills", { bill: "BILL-1", vendor: "Green Acres Landscaping", property: null, status: "Approved", amount: 3660.5, due_on: "2026-11-30", gl: null }))
      .toBe("Approved bill from Green Acres Landscaping: $3,660.50, due Nov 30.");
    expect(say("leases", { lease: "Lee household · #412", status: "Active", start: "2026-01-12", end: "2027-01-11", rent: 1795, market_rent: 1850.25, balance: 0.4, residents: 1, days_to_end: 68 }))
      .toBe("Active lease for Lee household · #412, Jan 12 to Jan 11, 2027, at $1,795 a month (market $1,850.25). 1 resident on the lease. $0.40 is owed. It ends in 68 days.");
  });

  it("a lease ending today", () => {
    expect(say("leases", { lease: "Chen household · #328", status: "Active", start: "2026-05-05", end: "2026-11-04", rent: 2345, market_rent: 2345, balance: 0, residents: 1, days_to_end: 0 }))
      .toBe("Active lease for Chen household · #328, May 5 to Nov 4, at $2,345 a month. 1 resident on the lease. No balance owed. It ends today.");
  });

  it("residents", () => {
    expect(say("residents", { resident: "Jordan Lee", status: "Current", unit: "#412", balance: 2180, lease_end: "2027-01-11", risk_score: 21, autopay: false, nsf_payments: 0 }))
      .toBe("Jordan Lee in #412 is a current resident with a lease ending Jan 11, 2027. Owes $2,180. Not on autopay. Delinquency risk score 21.");
    expect(say("residents", { resident: "Xavier Torres", status: "Notice", unit: "#101", balance: 0, lease_end: null, risk_score: null, autopay: true, nsf_payments: 2 }))
      .toBe("Xavier Torres in #101 is listed as notice. No balance owed. On autopay, with 2 returned payments.");
  });

  it("units", () => {
    expect(say("units", { unit: "South Congress Retail Row #Suite 109", status: "Vacant", beds: 0, market_rent: 8235, lease_rent: null, resident: null, lease_end: null, open_work_orders: 2 }))
      .toBe("South Congress Retail Row #Suite 109 is vacant, market rent $8,235. 2 open work orders.");
    expect(say("units", { unit: "The Lofts at Riverside #412", status: "Occupied", beds: 2, market_rent: 1850, lease_rent: 1795, resident: "Lee household", lease_end: "2027-01-11", open_work_orders: 0 }))
      .toBe("The Lofts at Riverside #412 is occupied, a 2-bed unit with market rent $1,850. Leased to Lee household at $1,795 a month until Jan 11, 2027. No open work orders.");
  });

  it("bills", () => {
    expect(say("bills", { bill: "BILL-20001 · GAL-20830", vendor: "Green Acres Landscaping", property: "The Lofts at Riverside", status: "Paid", amount: 3660, due_on: "2025-05-31", gl: "6100 · Landscaping" }))
      .toBe("Paid bill from Green Acres Landscaping for The Lofts at Riverside: $3,660, due May 31, 2025, coded to 6100 · Landscaping.");
  });

  it("prospects", () => {
    expect(say("prospects", { prospect: "Tyler Nguyen", stage: "Tour scheduled", source: "Zillow", budget: 1700, desired_beds: 2, days_since_contact: 0 }))
      .toBe("Tyler Nguyen is at the tour scheduled stage, from Zillow. Looking for a 2-bed home with a budget of $1,700. Last contacted today.");
    expect(say("prospects", { prospect: "Ana Ruiz", stage: "New", source: null, budget: null, desired_beds: 0, days_since_contact: 12 }))
      .toBe("Ana Ruiz is at the new stage. Looking for a studio. Last contacted 12 days ago.");
  });

  it("compliance items", () => {
    expect(say("compliance_items", { item: "Annual fire marshal inspection — The Lofts at Riverside", kind: "Fire inspection", status: "Open", due_on: "2027-05-04", days_to_due: 181, property: "The Lofts at Riverside", completed_on: null }))
      .toBe("Annual fire marshal inspection — The Lofts at Riverside (fire inspection) is open, due May 4, 2027, in 181 days.");
    expect(say("compliance_items", { item: "Elevator permit", kind: "Elevator", status: "Overdue", due_on: "2026-10-20", days_to_due: -15, property: "Barton Creek Commons", completed_on: null }))
      .toBe("Elevator permit (elevator) is overdue, past its due date of Oct 20.");
    expect(say("compliance_items", { item: "Backflow test", kind: "Backflow", status: "Done", due_on: "2025-11-08", days_to_due: -361, property: "The Lofts at Riverside", completed_on: "2025-10-28" }))
      .toBe("Backflow test (backflow) was completed Oct 28, 2025.");
  });
});

describe("the generic rules summary", () => {
  it("reads as a sentence: state first, then humanized facts, never the title twice", () => {
    expect(rulesSummary("Rent 2025-05", { charge: "Rent 2025-05", status: "Paid", amount: 1385, balance: 0, due_on: "2025-05-01", days_late: null }))
      .toBe("Rent 2025-05 is paid: amount 1,385, balance 0, due on May 1, 2025.");
    expect(rulesSummary("Helen Carter", { owner: "Helen Carter", kind: "Individual", fund: false }))
      .toBe("Helen Carter: kind Individual, fund no.");
    expect(rulesSummary("WO-1", { note: "" })).toBe("WO-1.");
  });

});
