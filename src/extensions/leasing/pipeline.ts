import type { Role } from "@/entities/types";

// The leasing pipeline board: six columns over two tables. A card is a prospect; once they apply,
// the application's stage decides the column. Moves are validated here so the board and the
// action share one set of rules.

export const COLUMNS = [
  { key: "lead", label: "Lead" },
  { key: "tour", label: "Tour" },
  { key: "applied", label: "Applied" },
  { key: "screening", label: "Screening" },
  { key: "approved", label: "Approved" },
  { key: "leased", label: "Leased" },
] as const;
export type Column = (typeof COLUMNS)[number]["key"];
export const COLUMN_KEYS = COLUMNS.map((c) => c.key) as [Column, ...Column[]];

export function columnOf(prospectStage: string, appStage: string | null): Column | null {
  if (prospectStage === "Leased" || appStage === "Leased") return "leased";
  if (appStage === "Approved" || appStage === "Conditional") return "approved";
  if (appStage === "Screening" || appStage === "Review") return "screening";
  if (prospectStage === "Applied") return appStage === "Denied" || appStage === "Withdrawn" ? null : "applied";
  if (prospectStage === "Tour scheduled" || prospectStage === "Toured") return "tour";
  if (prospectStage === "Inquiry" || prospectStage === "Contacted") return "lead";
  return null;
}

export const APPROVERS: Role[] = ["principal", "regional_manager", "property_manager", "broker"];

export type Move =
  | { ok: true; prospectStage?: string; appStage?: string; decide?: boolean }
  | { ok: false; status: 403 | 409; error: string };

// What a move does to the records. Only one step at a time, and only the approvers can drag a
// card into Approved; leasing agents send the application to the broker instead.
export function planMove(from: Column, to: Column, ctx: { role: Role; hasApplication: boolean; toured: boolean }): Move {
  const i = COLUMN_KEYS.indexOf(from), j = COLUMN_KEYS.indexOf(to);
  if (i === j) return { ok: false, status: 409, error: "The card is already in that column" };
  if (from === "leased") return { ok: false, status: 409, error: "Leased cards can't move back. Start a new lead instead." };
  if (Math.abs(j - i) > 1) return { ok: false, status: 409, error: `Move one step at a time: ${COLUMNS[i].label} goes to ${COLUMNS[Math.min(i + 1, 5)].label}${i > 0 ? ` or back to ${COLUMNS[i - 1].label}` : ""}` };
  if (to === "approved" || from === "approved") {
    if (!APPROVERS.includes(ctx.role)) return { ok: false, status: 403, error: "Approving an application is the broker's decision. Open the application to send it for review." };
    if (from === "approved") return { ok: false, status: 409, error: "An approval stands once made. Open the application to change the decision." };
    return { ok: true, appStage: "Approved", decide: true };
  }
  switch (to) {
    case "lead": return { ok: true, prospectStage: "Contacted" };
    case "tour": return from === "applied" && ctx.hasApplication ? { ok: false, status: 409, error: "This lead has applied. Withdraw the application from its page first." } : { ok: true, prospectStage: ctx.toured ? "Toured" : "Tour scheduled" };
    case "applied":
      if (!ctx.hasApplication) return { ok: false, status: 409, error: "No application yet. Send the application link, then move the card when it arrives." };
      return { ok: true, prospectStage: "Applied", appStage: "Submitted" };
    case "screening": return ctx.hasApplication ? { ok: true, appStage: "Screening" } : { ok: false, status: 409, error: "No application to screen yet" };
    case "leased": return { ok: true, prospectStage: "Leased", appStage: "Leased" };
  }
}
