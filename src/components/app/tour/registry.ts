import type { Role } from "@/entities/types";
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
