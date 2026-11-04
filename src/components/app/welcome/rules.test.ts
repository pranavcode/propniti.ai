import { describe, expect, it } from "vitest";
import type { GuideFacts } from "../guide/nudges";
import {
  askAutoDue, askAutoOpened, askGate, demoDay, dismissWelcome, FEATURES, isHome, markSeen, neverWelcome, newDot, offerPlace, pickToast, recordOffer, restoreWelcome, toastBlockedBy,
  waitingItems, welcomeDue, whatsNewBullets, type OfferTour, type ToastGate,
} from "./rules";

const ALL_TOURS = ["app-basics", ...FEATURES.map((f) => f.tour)];

describe("welcome splash", () => {
  it("shows until dismissed, then stays away for the rest of that demo day", () => {
    expect(welcomeDue({}, "daniel", "2026-11-04")).toBe(true);
    const prefs = dismissWelcome({}, "daniel", "2026-11-04");
    expect(welcomeDue(prefs, "daniel", "2026-11-04")).toBe(false);
    expect(welcomeDue(prefs, "daniel", "2026-11-05")).toBe(true);
  });

  it("remembers each persona separately", () => {
    const prefs = dismissWelcome({}, "daniel", "2026-11-04");
    expect(welcomeDue(prefs, "marcus", "2026-11-04")).toBe(true);
  });

  it("Don't show again is permanent until restored", () => {
    const off = neverWelcome({}, "daniel");
    expect(welcomeDue(off, "daniel", "2026-11-04")).toBe(false);
    expect(welcomeDue(off, "daniel", "2027-01-01")).toBe(false);
    expect(welcomeDue(off, "marcus", "2026-11-04")).toBe(true);
    expect(welcomeDue(restoreWelcome(off, "daniel"), "daniel", "2026-11-04")).toBe(true);
  });

  it("the day turns at midnight Pacific, when demo workspaces reset", () => {
    expect(demoDay(Date.parse("2026-11-05T07:59:00Z"))).toBe("2026-11-04");
    expect(demoDay(Date.parse("2026-11-05T08:01:00Z"))).toBe("2026-11-05");
  });

  it("belongs on the persona's home", () => {
    expect(isHome("/app/today", "/app/today")).toBe(true);
    expect(isHome("/app", "/app/admin")).toBe(true);
    expect(isHome("/app/inbox", "/app")).toBe(false);
  });

  it("lists only features the persona has, at most three", () => {
    expect(whatsNewBullets(ALL_TOURS).map((b) => b.name)).toEqual(["Inbox", "My tasks", "Automations"]);
    expect(whatsNewBullets(["feature-inbox", "feature-ask"]).map((b) => b.name)).toEqual(["Inbox", "Ask Propniti"]);
    expect(whatsNewBullets(ALL_TOURS).every((b) => b.name !== "Improve with AI")).toBe(true);
  });
});

describe("waiting for you", () => {
  const NAV = ["/app/ai/approvals", "/app/inbox", "/app/tasks", "/app/receivables/charges", "/app/data-health"];
  const facts: GuideFacts = { approvals: 3, pastDue: { cents: 4_821_000, properties: 2 }, dataIssues: { critical: 4 }, replies: 1, tasks: { overdue: 2, today: 5 } };

  it("words up to three items from the real counts, linking to the records", () => {
    expect(waitingItems(facts, NAV)).toEqual([
      { id: "approvals", text: "3 agent proposals need your decision", href: "/app/ai/approvals" },
      { id: "replies", text: "1 conversation is waiting on your reply", href: "/app/inbox?tab=messages" },
      { id: "tasks", text: "2 tasks are overdue", href: "/app/tasks?due=overdue" },
    ]);
  });

  it("falls back to tasks due today, past due and data issues when higher items are zero", () => {
    const quiet: GuideFacts = { ...facts, approvals: 0, replies: 0, tasks: { overdue: 0, today: 1 } };
    expect(waitingItems(quiet, NAV).map((w) => w.text)).toEqual(["1 task is due today", "$48,210 is more than 30 days past due across 2 properties", "4 critical data issues are open"]);
  });

  it("never invents a figure: no facts or pages the persona can't open, no items", () => {
    expect(waitingItems(null, NAV)).toEqual([]);
    expect(waitingItems(facts, [])).toEqual([]);
    expect(waitingItems({ approvals: null, pastDue: null, dataIssues: null }, NAV)).toEqual([]);
  });
});

describe("new-feature dots", () => {
  it("shows a dot on a feature's nav item until its page is visited", () => {
    expect(newDot("/app/inbox", ALL_TOURS, {})).toBe(true);
    const seen = markSeen({}, "/app/inbox", ALL_TOURS);
    expect(newDot("/app/inbox", ALL_TOURS, seen)).toBe(false);
    expect(newDot("/app/tasks", ALL_TOURS, seen)).toBe(true);
  });

  it("Import's dot sits on Settings and clears on the import page", () => {
    expect(newDot("/app/settings", ALL_TOURS, {})).toBe(true);
    expect(newDot("/app/settings", ALL_TOURS, markSeen({}, "/app/settings", ALL_TOURS))).toBe(true);
    expect(newDot("/app/settings", ALL_TOURS, markSeen({}, "/app/settings/import", ALL_TOURS))).toBe(false);
  });

  it("no dot for a feature the persona doesn't have, or for items that aren't features", () => {
    expect(newDot("/app/automations", ["feature-inbox"], {})).toBe(false);
    expect(newDot("/app/properties", ALL_TOURS, {})).toBe(false);
  });

  it("returns the same state when nothing new was seen", () => {
    const s = markSeen({}, "/app/inbox", ALL_TOURS);
    expect(markSeen(s, "/app/inbox", ALL_TOURS)).toBe(s);
    expect(markSeen(s, "/app/properties", ALL_TOURS)).toBe(s);
  });
});

describe("feature-tour toasts", () => {
  const tour = (id: string, over: Partial<OfferTour> = {}): OfferTour => ({ id, title: id, steps: 4, paths: [], status: null, ...over });
  const TOURS = [tour("app-basics", { steps: 7 }), ...FEATURES.map((f) => tour(f.tour))];
  const gate = (over: Partial<ToastGate> = {}): ToastGate => ({ splash: false, dialog: false, peek: false, tour: false, nudge: false, panel: false, shownThisView: false, ...over });

  it("offers the page's feature tour on a first visit", () => {
    expect(pickToast({ path: "/app/inbox", tours: TOURS, present: [], state: {} })).toEqual({ tour: "feature-inbox", text: "New: Inbox — take a 30-second tour?" });
    expect(pickToast({ path: "/app/settings/import", tours: TOURS, present: [], state: {} })?.tour).toBe("feature-import");
  });

  it("offers once per feature: shown, dismissed or started all count", () => {
    for (const outcome of ["shown", "dismissed", "started"] as const) {
      expect(pickToast({ path: "/app/inbox", tours: TOURS, present: [], state: recordOffer({}, "feature-inbox", outcome) })).toBeNull();
    }
  });

  it("skips a tour the person already started or finished from Help", () => {
    const tours = TOURS.map((t) => (t.id === "feature-inbox" ? { ...t, status: "Completed" as const } : t));
    expect(pickToast({ path: "/app/inbox", tours, present: [], state: {} })).toBeNull();
  });

  it("offers Improve with AI only when its control is on the page", () => {
    expect(pickToast({ path: "/app", tours: TOURS, present: [], state: {} })).toBeNull();
    expect(pickToast({ path: "/app", tours: TOURS, present: ["improve-ai"], state: {} })?.tour).toBe("feature-improve-ai");
  });

  it("offers the chat bubble tour on any page that has the bubble, after the page's own feature", () => {
    expect(pickToast({ path: "/app/properties", tours: TOURS, present: ["ask"], state: {} })?.tour).toBe("feature-ask");
    expect(pickToast({ path: "/app/inbox", tours: TOURS, present: ["ask"], state: {} })?.tour).toBe("feature-inbox");
  });

  it("offers a page's own product tour if it was never started (replacing the bubble's nudge), never the basics", () => {
    const tours = [...TOURS, tour("pm-today", { title: "Your day", steps: 5, paths: ["/app/today"] })];
    expect(pickToast({ path: "/app/today", tours, present: [], state: {} })).toEqual({ tour: "pm-today", text: "New to this page? “Your day” walks through it in 5 steps." });
    expect(pickToast({ path: "/app", tours: [tour("app-basics", { paths: ["/app"] })], present: [], state: {} })).toBeNull();
  });

  it("offers one tour per browser session", () => {
    expect(pickToast({ path: "/app/inbox", tours: TOURS, present: [], state: {}, offeredThisSession: true })).toBeNull();
  });

  it("shows the offer as a toast only beside an open desktop sidebar; elsewhere the bubble offers it", () => {
    expect(offerPlace({ viewport: 1440, sidebar: 244 })).toBe("toast");
    expect(offerPlace({ viewport: 1440, sidebar: 52 })).toBe("bubble");
    expect(offerPlace({ viewport: 900, sidebar: 0 })).toBe("bubble");
    expect(offerPlace({ viewport: 390, sidebar: 0 })).toBe("bubble");
  });

  it("only for tours the persona has", () => {
    expect(pickToast({ path: "/app/automations", tours: TOURS.filter((t) => t.id !== "feature-automations"), present: [], state: {} })).toBeNull();
  });

  it("never while the splash, a dialog, the peek drawer, a tour or a bubble nudge is showing, and once per page view", () => {
    expect(toastBlockedBy(gate())).toBeNull();
    expect(toastBlockedBy(gate({ splash: true }))).toBe("splash");
    expect(toastBlockedBy(gate({ dialog: true }))).toBe("dialog");
    expect(toastBlockedBy(gate({ peek: true }))).toBe("peek");
    expect(toastBlockedBy(gate({ tour: true }))).toBe("tour");
    expect(toastBlockedBy(gate({ nudge: true }))).toBe("nudge");
    expect(toastBlockedBy(gate({ panel: true }))).toBe("panel");
    expect(toastBlockedBy(gate({ shownThisView: true }))).toBe("shownThisView");
  });
});

describe("Ask Propniti opens on its own once a day", () => {
  const base = { prefs: {}, persona: "daniel", day: "2026-11-04", path: "/app", phone: false, tipsOff: false, panelOpen: false };

  it("opens once per persona per demo day", () => {
    expect(askAutoDue(base)).toBe(true);
    const prefs = askAutoOpened({}, "daniel", "2026-11-04");
    expect(askAutoDue({ ...base, prefs })).toBe(false);
    expect(askAutoDue({ ...base, prefs, persona: "marcus" })).toBe(true);
    expect(askAutoDue({ ...base, prefs, day: "2026-11-05" })).toBe(true);
  });

  it("never on phones, on the full-page assistant, with tips off, or when the panel is already open", () => {
    expect(askAutoDue({ ...base, phone: true })).toBe(false);
    expect(askAutoDue({ ...base, path: "/app/copilot" })).toBe(false);
    expect(askAutoDue({ ...base, tipsOff: true })).toBe(false);
    expect(askAutoDue({ ...base, panelOpen: true })).toBe(false);
    expect(askAutoDue({ ...base, path: "/portal/owner" })).toBe(false);
  });

  it("waits for the splash, a dialog, a tour or the peek drawer; gives way to a tour toast", () => {
    const g = { splash: false, dialog: false, tour: false, peek: false, toast: false };
    expect(askGate(g)).toBe("go");
    for (const k of ["splash", "dialog", "tour", "peek"] as const) expect(askGate({ ...g, [k]: true })).toBe("wait");
    expect(askGate({ ...g, toast: true })).toBe("skip");
    expect(askGate({ ...g, splash: true, toast: true })).toBe("skip");
  });
});
