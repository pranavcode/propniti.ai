import type { Role } from "@/entities/types";
import { readLocal } from "@/hooks/use-local-storage";
import { wallClock } from "@/lib/clock";
import { formatMoney } from "@/lib/format";
import { DEMO_RESET_TZ } from "@/lib/seed";
import type { GuideFacts } from "../guide/nudges";
import type { TourStatus } from "../tour/types";

// Rules for the home welcome splash, the "new" dots in the sidebar and the feature-tour toasts.
// Pure functions over what localStorage remembers; the components read and write the storage.

// localStorage "pn_welcome": persona id → the day the splash was dismissed, or "never".
export const WELCOME_KEY = "pn_welcome";
export type WelcomePrefs = Record<string, string>;
export const NEVER = "never";

// The demo's day. Seeded data is frozen at AS_OF, so the date part of the demo clock never moves;
// the day that does turn is the one demo workspaces reset on, midnight in DEMO_RESET_TZ.
export const demoDay = (realMs: number = Date.now()) => new Date(wallClock(realMs, DEMO_RESET_TZ)).toISOString().slice(0, 10);

export const welcomeDue = (prefs: WelcomePrefs, persona: string, day: string) => prefs[persona] !== NEVER && prefs[persona] !== day;
export const dismissWelcome = (prefs: WelcomePrefs, persona: string, day: string): WelcomePrefs => ({ ...prefs, [persona]: day });
export const neverWelcome = (prefs: WelcomePrefs, persona: string): WelcomePrefs => ({ ...prefs, [persona]: NEVER });
export const restoreWelcome = (prefs: WelcomePrefs, persona: string): WelcomePrefs => Object.fromEntries(Object.entries(prefs).filter(([k]) => k !== persona));

// "/app" renders a home for the personas it doesn't redirect (admins land on /app/admin otherwise).
export const isHome = (path: string, home: string) => path === home || path === "/app";
// The one impure helper: whether the splash opens on this page view (the bubble and toasts hold back).
export const splashDue = (path: string, p: { id: string; home: string }) => isHome(path, p.home) && welcomeDue(readLocal<WelcomePrefs>(WELCOME_KEY, {}), p.id, demoDay());

export const ROLE_LINE: Record<Role, string> = {
  platform_admin: "Propniti shows you every customer organization, its usage and the health of the system.",
  principal: "Propniti checks your portfolio's numbers, explains why they move, and brings you only the decisions that need you.",
  regional_manager: "Propniti watches your region's properties, flags where rent or work orders slip, and drafts the fixes for you to approve.",
  property_manager: "Propniti handles routine work at your properties and brings you the conversations, approvals and work orders that need a person.",
  leasing_agent: "Propniti keeps your leads, tours and applications moving and drafts follow-ups for you to send.",
  broker: "Propniti tracks your agents, listings and compliance and brings you what needs a broker's approval.",
  accountant: "Propniti ties every figure to its records, so closing, reconciling and paying owners and vendors goes faster.",
  maintenance_supervisor: "Propniti triages requests, suggests who to dispatch, and brings you spend that needs approval.",
  admin: "Propniti keeps your company setup, users, roles, imports and policies in one place.",
  owner: "Propniti shows how your properties are doing and what was paid out.",
  resident: "Propniti keeps your rent, requests and messages in one place.",
  vendor: "Propniti lists your jobs, invoices and payments.",
  applicant: "Propniti shows where your application stands.",
};

// Features with their own short tour. `paths`: pages the feature lives on (the toast and the nav
// dot follow them). `nav`: the sidebar item that carries the "new" dot. `requires`: the feature
// has no page of its own and is offered wherever this element is on screen.
export type Feature = { id: string; name: string; tour: string; blurb?: string; paths?: string[]; nav?: string; requires?: string };
export const FEATURES: Feature[] = [
  { id: "inbox", name: "Inbox", tour: "feature-inbox", paths: ["/app/inbox"], nav: "/app/inbox", blurb: "conversations, approvals and alerts that need you, in one list." },
  { id: "tasks", name: "My tasks", tour: "feature-tasks", paths: ["/app/tasks"], nav: "/app/tasks", blurb: "your follow-ups by due date, from people, automations and agents." },
  { id: "automations", name: "Automations", tour: "feature-automations", paths: ["/app/automations"], nav: "/app/automations", blurb: "what runs on its own, when, and under which approval rules." },
  { id: "import", name: "Import", tour: "feature-import", paths: ["/app/settings/import"], nav: "/app/settings", blurb: "bring properties, residents and balances over from your current tool." },
  { id: "improve-ai", name: "Improve with AI", tour: "feature-improve-ai", requires: '[data-tour="improve-with-ai"]' },
  { id: "ask", name: "Ask Propniti", tour: "feature-ask", requires: "[data-chat-bubble]", blurb: "the chat bubble answers from your data and shows the records it used." },
];
const has = (tourIds: string[], f: Feature) => tourIds.includes(f.tour);

export const whatsNewBullets = (tourIds: string[]) => FEATURES.filter((f) => f.blurb && has(tourIds, f)).slice(0, 3).map((f) => ({ name: f.name, text: f.blurb! }));

// localStorage "pn_whats_new": features whose page was visited (no more dot) and the toast offered per tour.
export const WHATS_NEW_KEY = "pn_whats_new";
export type OfferOutcome = "shown" | "dismissed" | "started";
export type WhatsNew = { seen?: string[]; offers?: Record<string, OfferOutcome> };

export const newDot = (href: string, tourIds: string[], s: WhatsNew) =>
  FEATURES.some((f) => f.nav === href && has(tourIds, f) && !s.seen?.includes(f.id));

export function markSeen(s: WhatsNew, path: string, tourIds: string[]): WhatsNew {
  const add = FEATURES.filter((f) => f.paths?.includes(path) && has(tourIds, f) && !s.seen?.includes(f.id)).map((f) => f.id);
  return add.length ? { ...s, seen: [...(s.seen ?? []), ...add] } : s;
}

export const recordOffer = (s: WhatsNew, tour: string, outcome: OfferOutcome): WhatsNew => ({ ...s, offers: { ...s.offers, [tour]: outcome } });

export type ToastGate = { splash: boolean; dialog: boolean; peek: boolean; tour: boolean; nudge: boolean; panel: boolean; shownThisView: boolean };
export const toastBlockedBy = (g: ToastGate) => (Object.keys(g) as (keyof ToastGate)[]).find((k) => g[k]) ?? null;

export type OfferTour = { id: string; title: string; steps: number; paths: string[]; status: TourStatus | null };
export type Offer = { tour: string; text: string };

// sessionStorage "pn_offer_session": set once a tour was offered in this browser session.
export const OFFER_SESSION_KEY = "pn_offer_session";

// A toast sits over the open desktop sidebar's foot (bottom left), so it never covers the page. With
// no room there (phones, tablets, the collapsed rail) the chat bubble offers the tour instead.
export const offerPlace = (w: { viewport: number; sidebar: number }): "toast" | "bubble" => (w.viewport >= 1024 && w.sidebar >= 200 ? "toast" : "bubble");

// One offer per browser session: the page's feature, then a feature on screen (Improve with AI before
// the bubble), then the page's own product tour. A tour already offered, started or finished never is.
export function pickToast(i: { path: string; tours: OfferTour[]; present: string[]; state: WhatsNew; offeredThisSession?: boolean }): Offer | null {
  if (i.offeredThisSession) return null;
  const open = (id: string) => {
    const t = i.tours.find((x) => x.id === id);
    return t && t.status === null && !i.state.offers?.[id] ? t : null;
  };
  const features = [...FEATURES.filter((f) => f.paths?.includes(i.path)), ...FEATURES.filter((f) => f.requires && i.present.includes(f.id))];
  for (const f of features) if (open(f.tour)) return { tour: f.tour, text: `New: ${f.name} — take a 30-second tour?` };
  const featureTours = new Set(FEATURES.map((f) => f.tour));
  for (const t of i.tours) {
    if (t.id !== "app-basics" && !featureTours.has(t.id) && t.paths.includes(i.path) && open(t.id)) {
      return { tour: t.id, text: `New to this page? “${t.title}” walks through it in ${t.steps} steps.` };
    }
  }
  return null;
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// "Waiting for you" on the splash: up to three items, each worded from a count in GuideFacts and
// linking to the page that lists the same records. No count, no item.
export function waitingItems(f: GuideFacts | null, nav: string[]): { id: string; text: string; href: string }[] {
  if (!f) return [];
  const out: { id: string; text: string; href: string }[] = [];
  const can = (href: string) => nav.includes(href);
  if (f.approvals && can("/app/ai/approvals")) out.push({ id: "approvals", text: `${count(f.approvals, "agent proposal needs", "agent proposals need")} your decision`, href: "/app/ai/approvals" });
  if (f.replies && can("/app/inbox")) out.push({ id: "replies", text: `${count(f.replies, "conversation is", "conversations are")} waiting on your reply`, href: "/app/inbox?tab=messages" });
  if (f.tasks && can("/app/tasks")) {
    if (f.tasks.overdue) out.push({ id: "tasks", text: `${count(f.tasks.overdue, "task is", "tasks are")} overdue`, href: "/app/tasks?due=overdue" });
    else if (f.tasks.today) out.push({ id: "tasks", text: `${count(f.tasks.today, "task is", "tasks are")} due today`, href: "/app/tasks?due=today" });
  }
  if (f.pastDue && f.pastDue.cents > 0 && can("/app/receivables/charges")) {
    out.push({ id: "pastdue", text: `${formatMoney(f.pastDue.cents / 100, "whole")} is more than 30 days past due across ${count(f.pastDue.properties, "property", "properties")}`, href: "/app/receivables/delinquency" });
  }
  if (f.dataIssues?.critical && can("/app/data-health")) out.push({ id: "data", text: `${count(f.dataIssues.critical, "critical data issue is", "critical data issues are")} open`, href: "/app/data-health?severity=critical" });
  return out.slice(0, 3);
}

// The Ask Propniti panel opens on its own once a demo day per persona, so its "Right now" section
// greets them: after the splash closes, or on the day's first page view when there is no splash.
// localStorage "pn_ask_auto": persona id → the day it last opened on its own (closing it changes nothing).
export const ASK_AUTO_KEY = "pn_ask_auto";
export type AskAuto = Record<string, string>;

export type AskInput = { prefs: AskAuto; persona: string; day: string; path: string; phone: boolean; tipsOff: boolean; panelOpen: boolean };
// Whether this page view may auto-open the panel at all (the full-page assistant and phones, where
// the panel covers the screen, never do).
export function askAutoDue(i: AskInput): boolean {
  return i.prefs[i.persona] !== i.day && !i.tipsOff && !i.phone && !i.panelOpen && i.path !== "/app/copilot" && i.path.startsWith("/app");
}
export const askAutoOpened = (prefs: AskAuto, persona: string, day: string): AskAuto => ({ ...prefs, [persona]: day });

// What's on screen. "wait" lets the splash, a dialog, a tour or the peek drawer finish first; a
// tour toast ends the attempt for this page view, so the two never stack.
export type AskGate = { splash: boolean; dialog: boolean; tour: boolean; peek: boolean; toast: boolean };
export function askGate(g: AskGate): "go" | "wait" | "skip" {
  if (g.toast) return "skip";
  return g.splash || g.dialog || g.tour || g.peek ? "wait" : "go";
}
