import { formatMoney } from "@/lib/format";

// Rules for the chat bubble's nudges: which one (if any) to show for this persona and page, from
// counts the server computed. No model decides anything here, and a nudge never states a figure
// that isn't in GuideFacts.

export const GAP_MS = 2 * 60_000;      // between two nudges
export const MAX_PER_SESSION = 5;
export const EXPLAIN_SELECTOR = 'button[aria-label^="Explain "]';
export const PEEK_ROW_SELECTOR = "tbody a[data-peek-id]";

// From GET /api/guide. null = the persona can't see that area.
export type GuideFacts = {
  approvals: number | null;                                // Approvals › Needs you
  pastDue: { cents: number; properties: number } | null;   // open balances more than 30 days past due
  dataIssues: { critical: number } | null;                 // open critical data issues
  remind?: { residents: number } | null;                   // residents 30+ days late (what "send reminders" drafts)
};

// localStorage: "Don't show tips", dismissed nudges (id → the key it had) and whether Explain was used.
export type GuidePrefs = { off?: boolean; dismissed?: Record<string, string>; explained?: boolean };
// sessionStorage: nudges shown this session.
export type GuideSession = { shown: { id: string; at: number }[] };

export type TourState = { id: string; title: string; steps: number; paths: string[]; status: "Active" | "Completed" | "Dismissed" | null; step: number };

export type NudgeAction = { label: string } & (
  | { kind: "href"; href: string }
  | { kind: "ask"; prompt: string }
  | { kind: "tour"; tour: string }
  | { kind: "click"; selector: string }
);
// A dismissal stores the nudge's key: the day for data nudges (they may return tomorrow, not each
// time an agent adds a proposal), a constant for tips (they never return).
export type Nudge = { id: string; key: string; text: string; source: string; action: NudgeAction };

export type NudgeInput = {
  path: string;
  search: string;
  day: string;                                             // local date, YYYY-MM-DD
  nav: string[];                                           // hrefs the persona can open
  facts: GuideFacts | null;
  tours: TourState[];
  page: { explain: boolean; peekRows: boolean };           // what's on screen now
  prefs: GuidePrefs;
  session: GuideSession;
};

export type Gate = {
  now: number;
  prefs: GuidePrefs;
  session: GuideSession;
  shownThisView: boolean;
  tourActive: boolean;
  firstTourPending: boolean;    // the first-visit tour is about to start
  typing: boolean;
  overlay: boolean;             // a dialog, drawer or menu is open
};

export function blockedBy(g: Gate): "off" | "tour" | "typing" | "overlay" | "view" | "cap" | "cooldown" | null {
  if (g.prefs.off) return "off";
  if (g.tourActive || g.firstTourPending) return "tour";
  if (g.typing) return "typing";
  if (g.overlay) return "overlay";
  if (g.shownThisView) return "view";
  if (g.session.shown.length >= MAX_PER_SESSION) return "cap";
  const last = Math.max(-Infinity, ...g.session.shown.map((s) => s.at));
  if (g.now - last < GAP_MS) return "cooldown";
  return null;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const under = (path: string, base: string) => path === base || path.startsWith(base + "/");

// In priority order: work waiting for the person first, then how to use this page, then the tour.
function candidates(i: NudgeInput): Nudge[] {
  const out: Nudge[] = [];
  const f = i.facts;
  const has = (href: string) => i.nav.includes(href);

  if (f?.approvals && has("/app/ai/approvals") && !under(i.path, "/app/ai/approvals")) {
    out.push({
      id: "approvals", key: i.day, source: "Approvals · Needs you",
      text: `${plural(f.approvals, "agent proposal is", "agent proposals are")} waiting for a decision.`,
      action: { kind: "href", href: "/app/ai/approvals", label: "Review" },
    });
  }
  // The aging page's 31–60, 61–90 and 90+ totals add up to this figure.
  if (f?.pastDue && f.pastDue.cents > 0 && has("/app/receivables/charges") && !under(i.path, "/app/receivables")) {
    out.push({
      id: "pastdue", key: i.day, source: "Delinquency aging",
      text: `${formatMoney(f.pastDue.cents / 100, "whole")} in past-due balances is more than 30 days old, across ${plural(f.pastDue.properties, "property", "properties")}.`,
      action: { kind: "href", href: "/app/receivables/delinquency", label: "See aging" },
    });
  }
  if (f?.dataIssues?.critical && has("/app/data-health") && !under(i.path, "/app/data-health")) {
    out.push({
      id: "data", key: i.day, source: "Data health",
      text: `${plural(f.dataIssues.critical, "critical data issue is", "critical data issues are")} open in records that money depends on.`,
      action: { kind: "href", href: "/app/data-health?severity=critical", label: "Review fixes" },
    });
  }

  for (const t of i.tours) {
    if (t.id !== "app-basics" && t.status === null && t.paths.includes(i.path)) {
      out.push({ id: `tour.${t.id}`, key: "1", source: "Product tour", text: `New to this page? “${t.title}” walks through it in ${t.steps} steps.`, action: { kind: "tour", tour: t.id, label: "Start tour" } });
    }
  }
  if (/^\/app\/properties\/[^/]+$/.test(i.path)) {
    out.push({ id: "tip.ask-noi", key: "1", source: "Tip", text: "Ask why this property's NOI changed. Propniti answers from computed figures and shows every record it looked up.", action: { kind: "ask", prompt: "Why did NOI change at this property?", label: "Ask Propniti" } });
  }
  if (i.page.explain && !i.prefs.explained) {
    out.push({ id: "tip.explain", key: "1", source: "Tip", text: "Select Explain on any number to see why it moved: the properties and drivers behind the change.", action: { kind: "click", selector: EXPLAIN_SELECTOR, label: "Try it" } });
  }
  if (i.path === "/app/receivables/collections" && !new URLSearchParams(i.search).has("band")) {
    out.push({ id: "tip.collections-risk", key: "1", source: "Tip", text: "This list can be filtered by risk. Start with the high-risk residents?", action: { kind: "href", href: "/app/receivables/collections?band=High", label: "Show high risk" } });
  }
  if (i.page.peekRows) {
    out.push({ id: "tip.peek", key: "1", source: "Tip", text: "Select any row to preview it without leaving the list. J and K move between rows.", action: { kind: "click", selector: PEEK_ROW_SELECTOR, label: "Preview a row" } });
  }
  const basics = i.tours.find((t) => t.id === "app-basics");
  if (basics?.status === "Dismissed" && basics.step <= 1) {
    out.push({ id: "tour.basics", key: "1", source: "Product tour", text: "New here? The 2-minute tour shows where everything lives.", action: { kind: "tour", tour: "app-basics", label: "Take the tour" } });
  }
  return out;
}

export function pickNudge(i: NudgeInput): Nudge | null {
  const seen = new Set(i.session.shown.map((s) => s.id));
  return candidates(i).find((n) => !seen.has(n.id) && i.prefs.dismissed?.[n.id] !== n.key) ?? null;
}

export const dismissNudge = (prefs: GuidePrefs, n: Nudge): GuidePrefs => ({ ...prefs, dismissed: { ...prefs.dismissed, [n.id]: n.key } });
export const recordShown = (s: GuideSession, n: Nudge, now: number): GuideSession => ({ shown: [...s.shown, { id: n.id, at: now }] });
