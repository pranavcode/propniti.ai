import type { Role } from "@/entities/types";

// Product tour definitions (plain data, so the server layout can pass them to the client).
// A step points at an element by its data-tour attribute: target "ask" → [data-tour="ask"].
// Steps without a target, or whose target isn't on the page, show as a centred card.

export type TourStep = {
  target?: string;
  title: string;
  body: string;
  href?: string;                       // navigate here before showing the step
  placement?: "top" | "bottom" | "left" | "right";
};

export type TourDef = { id: string; title: string; roles: Role[] | "all"; steps: TourStep[] };

export type TourStatus = "Active" | "Completed" | "Dismissed";
export type TourProgress = { tour: string; step: number; status: TourStatus; updatedAt: string };

// Where progress lives. LocalTourStore now; lane C swaps in one backed by tour_progress.
export interface TourStore {
  get(tour: string): TourProgress | null;
  set(p: TourProgress): void;
}
