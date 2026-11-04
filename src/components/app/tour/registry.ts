import { PERMISSIONS } from "@/auth/personas";
import { INTERNAL_ROLES, type Role } from "@/entities/types";
import type { TourDef } from "./types";

// Tour registry. Lanes register tours from server-imported modules (src/extensions/<module>/);
// the app layout passes toursFor(role) to the shell. Re-registering an id replaces it.

const tours = new Map<string, TourDef>();

export function registerTour(def: TourDef) {
  tours.set(def.id, def);
  return def;
}

export const toursFor = (role: Role) => [...tours.values()].filter((t) => t.roles === "all" || t.roles.includes(role));

// The shell tour: the parts of the frame every persona shares.
registerTour({
  id: "app-basics",
  title: "Getting around Propniti",
  roles: "all",
  steps: [
    { title: "Welcome to Propniti", body: "A two-minute tour of the frame: where things live, how to search, and how to ask the AI. You can leave any time and restart it from Help." },
    { target: "sidebar", title: "Everything in one sidebar", body: "Portfolio, Operations, Finance and Intelligence. Counts show what is waiting for you. Press ⌘B to collapse it.", placement: "right" },
    { target: "search", title: "Search or jump anywhere", body: "⌘K finds properties, units, residents and work orders by name, address or number, and runs commands.", placement: "bottom" },
    { target: "ask", title: "Ask Propniti", body: "⌘J opens the assistant. Ask about your data, tell it to do something, or ask how a feature works. It shows every record it looked up.", placement: "bottom" },
    { target: "notifications", title: "Notifications", body: "Approvals, mentions and agent results land here.", placement: "bottom" },
    { target: "profile", title: "Switch role (demo)", body: "See the product as a principal, accountant, leasing agent or a portal user. Each role has its own scope and home.", placement: "bottom" },
    { target: "setup", title: "Finish setting up", body: "The checklist tracks company, bank, import, team, roles and payment settings.", placement: "right" },
  ],
});

// Short tours for the newer features. The welcome splash lists them and a toast offers each one on
// the feature's first visit (welcome/rules.ts FEATURES); Help lists them all.
const STAFF: Role[] = [...INTERNAL_ROLES];
const withModule = (m: keyof (typeof PERMISSIONS)["admin"]) => STAFF.filter((r) => (PERMISSIONS[r][m] ?? "none") !== "none");

registerTour({
  id: "feature-inbox",
  title: "Inbox",
  roles: STAFF,
  steps: [
    { href: "/app/inbox", title: "Your inbox", body: "One list of what needs you: conversations waiting on your reply, agent proposals waiting on your decision, and alerts for you." },
    { href: "/app/inbox", target: 'nav[aria-label="Inbox filter"]', title: "Filter by kind", body: "All, Messages, Approvals or Alerts. Each count covers your scope only.", placement: "bottom" },
    { href: "/app/inbox", target: '[data-tour="sidebar"] a[href="/app/inbox"]', title: "The badge is the same count", body: "The number beside Inbox in the sidebar counts replies you owe, decisions waiting on you and unread alerts.", placement: "right" },
    { href: "/app/inbox", title: "Act where it happened", body: "Each item opens the conversation, proposal or alert it came from. The count drops as you reply, decide or read." },
  ],
});

registerTour({
  id: "feature-tasks",
  title: "My tasks",
  roles: STAFF,
  steps: [
    { href: "/app/tasks", title: "My tasks", body: "Follow-ups assigned to you, or to your role with no person named, from people, automations and AI agents." },
    { href: "/app/tasks", target: '[role="tablist"][aria-label="Due"]', title: "By due date", body: "Open, overdue, due today, upcoming and done. A red count means something is overdue.", placement: "bottom" },
    { href: "/app/tasks", target: "[data-table-search]", title: "Search and filter", body: "Search your tasks, or filter by record type, property, priority and source.", placement: "bottom" },
    { href: "/app/tasks", title: "Preview and finish", body: "Select a row to preview the task and the record it's about. Tick the box to mark it done." },
  ],
});

registerTour({
  id: "feature-automations",
  title: "Automations",
  roles: withModule("intelligence"),
  steps: [
    { href: "/app/automations", title: "Automations", body: "What runs on its own, when, and under which rules. Agents propose; a person approves anything involving money, legal terms or safety unless an approval rule allows it." },
    { href: "/app/automations", target: 'table[aria-label="Agents"]', title: "Agents and schedules", body: "Each agent runs on its schedule, when an event it listens for happens, or when someone presses Run now on the Agents page.", placement: "top" },
    { href: "/app/automations", target: 'table[aria-label="Event triggers"]', title: "Event triggers", body: "Which events start which agent. Events wait in a queue until the next 15-minute sweep picks them up.", placement: "top" },
    { href: "/app/automations", target: 'table[aria-label="Approval rules"]', title: "Approval rules", body: "Agents check these limits before anything applies on its own. Above a limit, the action becomes a proposal in Approvals.", placement: "top" },
  ],
});

registerTour({
  id: "feature-import",
  title: "Import data",
  roles: withModule("settings"),
  steps: [
    { href: "/app/settings/import", title: "Import data", body: "Bring your portfolio over from your current tool or a spreadsheet: properties, units, residents, leases, owners, vendors and open balances." },
    { href: "/app/settings/import", target: '[role="radiogroup"][aria-label="Source tool"]', title: "Start from your tool", body: "Pick where your data lives today, then upload its export files.", placement: "bottom" },
    { href: "/app/settings/import", target: 'ol[aria-label="Import steps"]', title: "Six steps", body: "Source, files, columns, review, preview and done. The current step is highlighted here.", placement: "bottom" },
    { href: "/app/settings/import", title: "Nothing is written until you confirm", body: "Every value is checked, and the preview shows what will be added. A finished import can be undone." },
  ],
});

registerTour({
  id: "feature-ask",
  title: "Ask Propniti",
  roles: STAFF,
  steps: [
    { target: "[data-chat-bubble]", title: "Ask Propniti", body: "Select the bubble, or press ⌘J, to ask about your data, tell it to do something, or ask how a feature works.", placement: "top" },
    { title: "Answers from your data", body: "Figures are computed from your records. The assistant words the answer and shows every record it looked up." },
    { target: "[data-chat-bubble]", title: "A tip now and then", body: "The bubble may suggest one thing worth a look, worded from your real counts. Turn tips off from the menu on the bubble.", placement: "top" },
  ],
});

// Offered only where the control is on screen ([data-tour="improve-with-ai"] on a KPI card).
registerTour({
  id: "feature-improve-ai",
  title: "Improve with AI",
  roles: STAFF,
  steps: [
    { target: "improve-with-ai", title: "Improve with AI", body: "Opens a panel on this number: what drives it and what could move it.", placement: "bottom" },
    { title: "Figures from data", body: "The panel's numbers are computed from your records. The model only words the suggestions." },
    { title: "You decide", body: "Nothing changes on its own. Anything that would change records or move money still goes through approval." },
  ],
});
