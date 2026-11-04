import { describe, expect, it } from "vitest";
import { hiddenToday, hideToday, rightNowItems } from "../ui/rightNow";

// "Right now" at the top of the Ask Propniti panel: up to three one-click items from GET /api/guide,
// only for areas the persona can open, hidden for the rest of the demo day when asked.

const NAV = ["/app/ai/approvals", "/app/data-health"];

describe("right now items", () => {
  it("come from the route's figures, in priority order, at most three", () => {
    const items = rightNowItems({ approvals: 4, pastDue: { cents: 100, properties: 1 }, dataIssues: { critical: 2 }, remind: { residents: 1 } }, NAV);
    expect(items.map((i) => i.text)).toEqual(["4 approvals are waiting for you", "1 resident is 30+ days late on rent", "2 critical data issues are open"]);
    expect(items.map((i) => i.action)).toEqual([
      { kind: "href", href: "/app/ai/approvals", label: "Review" },
      { kind: "ask", prompt: "Send reminders to residents 30+ days late", label: "Draft reminders" },
      { kind: "href", href: "/app/data-health?severity=critical", label: "Review fixes" },
    ]);
  });

  it("leave out zeros, areas the persona can't see and pages not in their nav", () => {
    expect(rightNowItems({ approvals: 0, pastDue: null, dataIssues: { critical: 0 }, remind: null }, NAV)).toEqual([]);
    expect(rightNowItems({ approvals: 3, pastDue: null, dataIssues: { critical: 1 }, remind: { residents: 2 } }, [])).toEqual([expect.objectContaining({ id: "remind" })]);
    expect(rightNowItems(null, NAV)).toEqual([]);
  });

  it("hide for today per persona, and come back the next day", () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    hideToday(ls, "marcus", "2026-11-04");
    expect(hiddenToday(ls, "marcus", "2026-11-04")).toBe(true);
    expect(hiddenToday(ls, "daniel", "2026-11-04")).toBe(false);
    expect(hiddenToday(ls, "marcus", "2026-11-05")).toBe(false);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => hideToday(broken, "marcus", "2026-11-04")).not.toThrow();
    expect(hiddenToday(broken, "marcus", "2026-11-04")).toBe(false);
  });
});
