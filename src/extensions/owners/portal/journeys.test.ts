import { describe, expect, it } from "vitest";
import { applicantJourney, insuranceJourney, missingToSubmit, moveOutJourney, renewalJourney, requestJourney, screeningChecks, type ApplicationFacts, type OfferFacts } from "./journeys";

// The portal trackers: which step is current for each record state, and what the person must do.

const app = (over: Partial<ApplicationFacts> = {}): ApplicationFacts => ({
  stage: "Started", submitted_at: null, fee_paid: 0, docs: [], screening: null, decided_at: null, decision_reason: null,
  lease_sent_at: null, lease_signed_at: null, move_in_on: null, desired_move_in: "2026-11-28", ...over,
});
const states = (j: { steps: { key: string; state: string }[] }) => Object.fromEntries(j.steps.map((s) => [s.key, s.state]));
const current = (j: { steps: { key: string; state: string }[] }) => j.steps.find((s) => s.state === "current" || s.state === "stopped")?.key ?? null;

describe("applicant journey", () => {
  it("starts on submission and lists what's missing to submit", () => {
    const j = applicantJourney(app());
    expect(current(j)).toBe("submitted");
    expect(j.next.you).toBe("Still needed: Photo ID, Pay stub, Application fee.");
    expect(missingToSubmit({ fee_paid: 1, docs: ["Photo ID", "Pay stub"] })).toEqual([]);
    expect(applicantJourney(app({ fee_paid: 1, docs: ["Photo ID", "Pay stub"] })).next.you).toBe("Submit your application.");
  });

  it("moves through screening, review and the decision", () => {
    expect(current(applicantJourney(app({ stage: "Submitted", submitted_at: "2026-11-04T10:00:00Z" })))).toBe("screening");
    expect(current(applicantJourney(app({ stage: "Screening", submitted_at: "x" })))).toBe("screening");
    const review = applicantJourney(app({ stage: "Review", screening: { completed_at: "2026-11-05T10:00:00Z", income_verified: 1 } }));
    expect(states(review)).toMatchObject({ submitted: "done", screening: "done", decision: "current", lease_sent: "todo" });
  });

  it("shows the screening checks as done or waiting, never the results", () => {
    expect(screeningChecks({ stage: "Screening", docs: ["Pay stub"], screening: null }).map((c) => c.state)).toEqual(["running", "running", "running"]);
    expect(screeningChecks({ stage: "Review", docs: ["Pay stub"], screening: { completed_at: "x", income_verified: 1 } }).map((c) => c.state)).toEqual(["done", "done", "done"]);
    expect(screeningChecks({ stage: "Review", docs: ["Photo ID"], screening: { completed_at: "x", income_verified: 0 } })[2].state).toBe("needs-docs");
  });

  it("stops at a denial and shows the reason the broker gave", () => {
    const j = applicantJourney(app({ stage: "Denied", decided_at: "x", decision_reason: "Income below 3× rent", screening: { completed_at: "x", income_verified: 1 } }));
    expect(states(j)).toMatchObject({ decision: "stopped", lease_sent: "todo", move_in: "todo" });
    expect(j.steps[2].label).toBe("Not approved");
    expect(j.next.body).toContain("Reason given: Income below 3× rent");
  });

  it("goes approved → lease sent → signed → move-in", () => {
    const base = { decided_at: "x", screening: { completed_at: "x", income_verified: 1 } };
    expect(current(applicantJourney(app({ stage: "Approved", ...base })))).toBe("lease_sent");
    const sent = applicantJourney(app({ stage: "Approved", lease_sent_at: "y", ...base }));
    expect(current(sent)).toBe("lease_signed");
    expect(sent.next.you).toBe("Read and sign your lease.");
    expect(current(applicantJourney(app({ stage: "Leased", lease_sent_at: "y", lease_signed_at: "z", ...base })))).toBe("move_in");
    const done = applicantJourney(app({ stage: "Leased", lease_sent_at: "y", lease_signed_at: "z", move_in_on: "2026-11-28", ...base }));
    expect(current(done)).toBeNull();
    expect(done.next.title).toBe("Move-in is scheduled");
  });

  it("labels a conditional approval with its conditions", () => {
    const j = applicantJourney(app({ stage: "Conditional", decided_at: "x", decision_reason: "A guarantor", screening: { completed_at: "x", income_verified: 1 } }));
    expect(j.steps[2]).toMatchObject({ label: "Approved with conditions", state: "done", detail: "Conditions: A guarantor" });
    expect(j.next.you).toContain("guarantor");
    const signed = applicantJourney(app({ stage: "Leased", decided_at: "x", decision_reason: "A guarantor", lease_sent_at: "y", lease_signed_at: "z", screening: { completed_at: "x", income_verified: 1 } }));
    expect(signed.steps[2].label).toBe("Approved with conditions");
  });
});

describe("maintenance request journey", () => {
  const r = (status: string, extra: Partial<Parameters<typeof requestJourney>[0]> = {}) => requestJourney({ status, opened_at: "2026-11-04T10:00:00Z", scheduled_at: null, completed_at: null, reached: {}, rated: null, ...extra });
  it.each([["New", "triaged"], ["Triaged", "scheduled"], ["Assigned", "scheduled"], ["On hold", "scheduled"], ["Scheduled", "in_progress"], ["In progress", "done"], ["Submitted", "done"], ["Completed", "rated"]])("%s → current step %s", (status, step) => {
    expect(current(r(status))).toBe(step);
  });
  it("asks for a rating when done, and finishes once rated", () => {
    expect(r("Completed").next.you).toBe("Rate the repair.");
    const rated = r("Paid", { rated: { stars: 5, at: "2026-11-05T10:00:00Z" } });
    expect(current(rated)).toBeNull();
    expect(rated.steps[5].detail).toBe("You gave 5 of 5.");
  });
  it("dates steps from the status history", () => {
    const j = r("In progress", { reached: { Triaged: "2026-11-04T11:00:00Z", Scheduled: "2026-11-04T12:00:00Z", "In progress": "2026-11-05T09:00:00Z" } });
    expect(j.steps.map((s) => s.date)).toEqual(["2026-11-04T10:00:00Z", "2026-11-04T11:00:00Z", "2026-11-04T12:00:00Z", "2026-11-05T09:00:00Z", null, null]);
  });
  it("marks a cancelled request stopped", () => {
    expect(r("Cancelled").steps.some((s) => s.state === "stopped" && s.label === "Cancelled")).toBe(true);
  });
});

describe("renters insurance journey", () => {
  const p = (status: string, review_note: string | null = null) => ({ status, review_note, uploaded_at: "2026-11-04T10:00:00Z", expires_on: "2027-11-01" });
  it("missing → uploaded → verified or rejected", () => {
    expect(insuranceJourney(null, null).next.you).toBe("Upload your declarations page.");
    expect(current(insuranceJourney(null, null))).toBe("uploaded");
    expect(states(insuranceJourney(p("Pending verification"), 300))).toEqual({ uploaded: "done", review: "current" });
    expect(states(insuranceJourney(p("Active"), 300))).toEqual({ uploaded: "done", review: "done" });
    const rej = insuranceJourney(p("Rejected", "Named insured isn't on the lease"), 300);
    expect(rej.steps[1]).toMatchObject({ state: "stopped", label: "Rejected" });
    expect(rej.next.you).toBe("Upload the correct declarations page.");
    expect(rej.next.body).toContain("Named insured");
  });
  it("asks for the renewal page when coverage ends within 30 days", () => {
    expect(insuranceJourney(p("Expiring"), 12).next.you).toContain("renewal");
  });
});

describe("renewal journey", () => {
  const o = (status: string, over: Partial<OfferFacts> = {}): OfferFacts => ({ status, sent_at: "2026-10-22", responded_at: null, expires_on: "2026-12-12", signed_at: null, resident_note: null, term_months: 12, ...over });
  it("offer → answer → signed", () => {
    expect(renewalJourney([])).toBeNull();
    expect(current(renewalJourney([o("Sent")])!)).toBe("answer");
    expect(renewalJourney([o("Sent")])!.next.body).toBe("Respond by Dec 12, 2026.");
    const acc = renewalJourney([o("Declined"), o("Accepted", { responded_at: "x" })])!;
    expect(current(acc)).toBe("signed");
    expect(acc.next.you).toBe("Sign your renewal.");
    expect(current(renewalJourney([o("Accepted", { signed_at: "y" })])!)).toBeNull();
  });
  it("stops at a counter-offer or a decline", () => {
    const c = renewalJourney([o("Countered", { resident_note: "12 months at $2,180" })])!;
    expect(c.steps[1]).toMatchObject({ state: "stopped", label: "Countered", detail: "You asked: 12 months at $2,180." });
    expect(renewalJourney([o("Declined")])!.next.you).toBe("Give notice with your move-out date.");
  });
});

describe("move-out journey", () => {
  const m = { notice_on: "2026-11-04", move_out_on: "2027-01-11", inspection_on: null, inspection_status: null, disposition: null };
  it("notice → inspection → deposit", () => {
    expect(moveOutJourney({ ...m, notice_on: null })).toBeNull();
    expect(current(moveOutJourney(m)!)).toBe("inspection");
    expect(current(moveOutJourney({ ...m, inspection_on: "2027-01-11", inspection_status: "Scheduled" })!)).toBe("deposit");
    const sent = moveOutJourney({ ...m, inspection_on: "2027-01-11", inspection_status: "Completed", disposition: { status: "Sent", sent_on: "2027-01-20", due_on: "2027-02-10", refund_cents: 120000 } })!;
    expect(current(sent)).toBeNull();
  });
});
