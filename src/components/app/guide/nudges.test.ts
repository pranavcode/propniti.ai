import { describe, expect, it } from "vitest";
import { blockedBy, dismissNudge, GAP_MS, MAX_PER_SESSION, pickNudge, recordShown, type Gate, type GuideFacts, type NudgeInput, type TourState } from "./nudges";

const NAV = ["/app", "/app/today", "/app/ai/approvals", "/app/data-health", "/app/properties", "/app/receivables/charges"];
const FACTS: GuideFacts = { approvals: 3, pastDue: { cents: 4_821_000, properties: 3 }, dataIssues: { critical: 4 } };
const NONE: GuideFacts = { approvals: 0, pastDue: { cents: 0, properties: 0 }, dataIssues: { critical: 0 } };
const basics = (status: TourState["status"], step = 0): TourState => ({ id: "app-basics", title: "Getting around Propniti", steps: 7, paths: [], status, step });

const input = (over: Partial<NudgeInput> = {}): NudgeInput => ({
  path: "/app/today", search: "", day: "2026-11-04", nav: NAV, facts: FACTS, tours: [basics("Completed", 7)],
  page: { explain: false, peekRows: false }, prefs: {}, session: { shown: [] }, ...over,
});

const gate = (over: Partial<Gate> = {}): Gate => ({
  now: 10 * GAP_MS, prefs: {}, session: { shown: [] }, shownThisView: false, tourActive: false, typing: false, overlay: false, ...over,
});

describe("eligibility", () => {
  it("allows a nudge on a quiet page", () => {
    expect(blockedBy(gate())).toBeNull();
  });

  it("never shows when tips are off, during a tour, while typing or under a dialog", () => {
    expect(blockedBy(gate({ prefs: { off: true } }))).toBe("off");
    expect(blockedBy(gate({ tourActive: true }))).toBe("tour");
    expect(blockedBy(gate({ typing: true }))).toBe("typing");
    expect(blockedBy(gate({ overlay: true }))).toBe("overlay");
  });

  it("shows at most one nudge per page view", () => {
    expect(blockedBy(gate({ shownThisView: true }))).toBe("view");
  });

  it("waits the cooldown after the last nudge", () => {
    const now = 10 * GAP_MS;
    expect(blockedBy(gate({ now, session: { shown: [{ id: "a", at: now - GAP_MS + 1000 }] } }))).toBe("cooldown");
    expect(blockedBy(gate({ now, session: { shown: [{ id: "a", at: now - GAP_MS }] } }))).toBeNull();
  });

  it("caps nudges per session", () => {
    const shown = Array.from({ length: MAX_PER_SESSION }, (_, i) => ({ id: `n${i}`, at: i }));
    expect(blockedBy(gate({ session: { shown } }))).toBe("cap");
  });
});

describe("selection", () => {
  it("leads with work waiting for the person, worded from the real count", () => {
    const n = pickNudge(input())!;
    expect(n.id).toBe("approvals");
    expect(n.text).toBe("3 agent proposals are waiting for a decision.");
    expect(n.action).toEqual({ kind: "href", href: "/app/ai/approvals", label: "Review" });
    expect(pickNudge(input({ facts: { ...FACTS, approvals: 1 } }))!.text).toBe("1 agent proposal is waiting for a decision.");
  });

  it("skips a nudge on the page it points to, and for pages the persona can't open", () => {
    expect(pickNudge(input({ path: "/app/ai/approvals" }))!.id).toBe("pastdue");
    expect(pickNudge(input({ nav: NAV.filter((h) => h !== "/app/ai/approvals") }))!.id).toBe("pastdue");
  });

  it("states balances over 30 days past due and links to the aging whose 31+ columns add up to it", () => {
    const n = pickNudge(input({ facts: { ...FACTS, approvals: 0 } }))!;
    expect(n.id).toBe("pastdue");
    expect(n.text).toBe("$48,210 in past-due balances is more than 30 days old, across 3 properties.");
    expect(n.action).toMatchObject({ kind: "href", href: "/app/receivables/delinquency" });
    expect(pickNudge(input({ path: "/app/receivables/delinquency", facts: { ...FACTS, approvals: 0 } }))!.id).not.toBe("pastdue");
    expect(pickNudge(input({ nav: NAV.filter((h) => !h.startsWith("/app/receivables")), facts: { ...FACTS, approvals: 0 } }))!.id).not.toBe("pastdue");
  });

  it("points to critical data issues", () => {
    const n = pickNudge(input({ facts: { ...FACTS, approvals: 0, pastDue: null } }))!;
    expect(n.id).toBe("data");
    expect(n.text).toContain("4 critical");
    expect(n.action).toMatchObject({ href: "/app/data-health?severity=critical" });
  });

  it("never invents a figure: no facts, no data nudges", () => {
    expect(pickNudge(input({ facts: null }))).toBeNull();
    expect(pickNudge(input({ facts: NONE }))).toBeNull();
  });

  it("falls back to page tips: Explain on KPI pages until the person has used it", () => {
    const n = pickNudge(input({ facts: NONE, page: { explain: true, peekRows: false } }))!;
    expect(n.id).toBe("tip.explain");
    expect(n.action.kind).toBe("click");
    expect(pickNudge(input({ facts: NONE, page: { explain: true, peekRows: false }, prefs: { explained: true } }))).toBeNull();
  });

  it("offers the risk filter on collections only when it isn't applied", () => {
    const at = { facts: NONE, path: "/app/receivables/collections" };
    expect(pickNudge(input({ ...at, search: "" }))).toMatchObject({ id: "tip.collections-risk", action: { href: "/app/receivables/collections?band=High" } });
    expect(pickNudge(input({ ...at, search: "?band=High" }))).toBeNull();
  });

  it("on a property, offers to ask why its NOI changed", () => {
    expect(pickNudge(input({ facts: NONE, path: "/app/properties/p01" }))).toMatchObject({ id: "tip.ask-noi", action: { kind: "ask", prompt: "Why did NOI change at this property?" } });
    expect(pickNudge(input({ facts: NONE, path: "/app/properties" }))).toBeNull();
  });

  it("explains row preview on lists", () => {
    expect(pickNudge(input({ facts: NONE, page: { explain: false, peekRows: true } }))!.id).toBe("tip.peek");
  });

  it("leaves a page's own tour to the feature-tour toast, and offers the basics tour only after a skip", () => {
    const pageTour: TourState = { id: "pm-today", title: "Your day", steps: 5, paths: ["/app/today"], status: null, step: 0 };
    expect(pickNudge(input({ facts: NONE, tours: [basics("Completed", 7), pageTour] }))).toBeNull();
    expect(pickNudge(input({ facts: NONE, tours: [basics("Dismissed", 0)] }))).toMatchObject({ id: "tour.basics", action: { kind: "tour", tour: "app-basics" } });
    expect(pickNudge(input({ facts: NONE, tours: [basics("Dismissed", 4)] }))).toBeNull();
  });
});

describe("memory", () => {
  it("a dismissed data nudge stays away for the day, even as its figure moves", () => {
    const n = pickNudge(input())!;
    const prefs = dismissNudge({}, n);
    expect(pickNudge(input({ prefs }))!.id).toBe("pastdue");
    expect(pickNudge(input({ prefs, facts: { ...FACTS, approvals: 5 } }))!.id).toBe("pastdue");
    expect(pickNudge(input({ prefs, day: "2026-11-05" }))!.id).toBe("approvals");
  });

  it("a dismissed tip never comes back", () => {
    const at = { facts: NONE, page: { explain: false, peekRows: true } };
    const prefs = dismissNudge({}, pickNudge(input(at))!);
    expect(pickNudge(input({ ...at, prefs }))).toBeNull();
  });

  it("the same nudge shows once per session", () => {
    const n = pickNudge(input())!;
    const session = recordShown({ shown: [] }, n, 1000);
    expect(session.shown).toEqual([{ id: "approvals", at: 1000 }]);
    expect(pickNudge(input({ session }))!.id).toBe("pastdue");
  });
});
