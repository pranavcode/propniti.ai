import { describe, expect, it } from "vitest";
import { applyPatch, canOnboard, EMPTY, nextStep, OnboardingPatch, prevStep, resumeStep, setupKeysFor, STEPS } from "./state";

// Onboarding progress: one JSON record per org, merged patch by patch, so a person can leave at any
// step and come back to the same place. Every step can be skipped.

describe("applyPatch and resumeStep", () => {
  it("starts at the first step", () => {
    expect(resumeStep(EMPTY)).toBe("company");
  });

  it("records done and skipped steps and resumes where the person left off", () => {
    let s = applyPatch(EMPTY, { at: "data", done: ["company"], company: { name: "Lakeside PM", states: ["TX", "GA"], size: 420 } });
    expect(resumeStep(s)).toBe("data");
    s = applyPatch(s, { at: "rules", skipped: ["data"] });
    expect(s).toMatchObject({ at: "rules", done: ["company"], skipped: ["data"], company: { name: "Lakeside PM", states: ["TX", "GA"], size: 420 } });
    expect(resumeStep(s)).toBe("rules");
  });

  it("moves a skipped step to done when it is finished later, and never lists a step twice", () => {
    let s = applyPatch(EMPTY, { skipped: ["data"] });
    s = applyPatch(s, { done: ["data", "data"], import: { batch: "0123456789", created: { properties: 2, units: 12 }, tool: "appfolio", ai: false } });
    expect(s.done).toEqual(["data"]);
    expect(s.skipped).toEqual([]);
    expect(s.import?.created).toEqual({ properties: 2, units: 12 });
  });

  it("keeps earlier answers when a later patch leaves them out", () => {
    let s = applyPatch(EMPTY, { company: { name: "A", states: ["AZ"], size: null } });
    s = applyPatch(s, { rules: { applied: ["pol-org-maintenance-spend"] } });
    expect(s.company?.name).toBe("A");
    s = applyPatch(s, { rules: { applied: ["agent:data_health"] } });
    expect(s.rules?.applied).toEqual(["pol-org-maintenance-spend", "agent:data_health"]);
  });

  it("resumes at the summary once every step is done or skipped", () => {
    const s = applyPatch(EMPTY, { done: ["company", "data", "rules"], skipped: ["team"], at: "check" });
    expect(resumeStep(s)).toBe("check");
  });
});

describe("OnboardingPatch schema", () => {
  it("caps and checks what the browser may store", () => {
    expect(OnboardingPatch.safeParse({ company: { name: "x".repeat(121), states: [], size: null } }).success).toBe(false);
    expect(OnboardingPatch.safeParse({ company: { name: "Ok", states: ["ZZ"], size: null } }).success).toBe(false);
    expect(OnboardingPatch.safeParse({ company: { name: "Ok", states: ["TX"], size: -1 } }).success).toBe(false);
    expect(OnboardingPatch.safeParse({ at: "nowhere" }).success).toBe(false);
    expect(OnboardingPatch.safeParse({ import: { batch: "not-a-batch", created: {}, tool: "appfolio", ai: false } }).success).toBe(false);
    expect(OnboardingPatch.safeParse({ extra: 1 }).success).toBe(false);
    expect(OnboardingPatch.safeParse({ at: "team", done: ["company"], company: { name: "Lakeside PM", states: ["TX"], size: 420 } }).success).toBe(true);
  });
});

describe("steps", () => {
  it("go in order with back and next", () => {
    expect(STEPS.map((s) => s.key)).toEqual(["company", "data", "rules", "team", "check"]);
    expect(nextStep("company")).toBe("data");
    expect(nextStep("check")).toBeNull();
    expect(prevStep("company")).toBeNull();
    expect(prevStep("team")).toBe("rules");
  });

  it("map to the setup checklist items they complete", () => {
    expect(setupKeysFor("data")).toEqual(["import"]);
    expect(setupKeysFor("rules")).toEqual(["payments"]);
    expect(setupKeysFor("team")).toEqual(["roles"]);
  });
});

describe("canOnboard", () => {
  it("is for the principal, regional managers and admins only", () => {
    expect(["principal", "regional_manager", "admin"].map((r) => canOnboard(r as never))).toEqual([true, true, true]);
    expect(["property_manager", "accountant", "leasing_agent", "broker", "maintenance_supervisor", "platform_admin", "owner", "resident", "vendor", "applicant"].some((r) => canOnboard(r as never))).toBe(false);
  });
});
