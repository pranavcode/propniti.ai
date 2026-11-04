import type { GuideFacts } from "@/components/app/guide/nudges";

// "Right now" at the top of the Ask Propniti panel: up to three things to do, worded from the
// counts GET /api/guide computed (no other figures), each one click: open the page or hand the
// assistant a prepared request that goes through the normal approval flow.

// The most reminders one "send reminders" request drafts (the assistant's delinquency lookup limit).
export const REMINDER_LIMIT = 25;

export type RightNowItem = { id: string; text: string; action: { kind: "href"; href: string; label: string } | { kind: "ask"; prompt: string; label: string } };

const n = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

export function rightNowItems(f: GuideFacts | null, nav: string[]): RightNowItem[] {
  if (!f) return [];
  const out: RightNowItem[] = [];
  if (f.approvals && nav.includes("/app/ai/approvals")) out.push({ id: "approvals", text: `${n(f.approvals, "approval is", "approvals are")} waiting for you`, action: { kind: "href", href: "/app/ai/approvals", label: "Review" } });
  if (f.remind?.residents) out.push({ id: "remind", text: `${n(f.remind.residents, "resident is", "residents are")} 30+ days late on rent`, action: { kind: "ask", prompt: "Send reminders to residents 30+ days late", label: f.remind.residents > REMINDER_LIMIT ? `Draft reminders for ${REMINDER_LIMIT} of ${f.remind.residents.toLocaleString("en-US")}` : "Draft reminders" } });
  if (f.dataIssues?.critical && nav.includes("/app/data-health")) out.push({ id: "data", text: `${n(f.dataIssues.critical, "critical data issue is", "critical data issues are")} open`, action: { kind: "href", href: "/app/data-health?severity=critical", label: "Review fixes" } });
  return out.slice(0, 3);
}

// Hidden for the rest of the demo day (workspaces reset at midnight Pacific), per persona.
// The store is read inside the try: touching window.localStorage itself throws when storage is blocked.
type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store => window.localStorage;
const key = (persona: string) => `pn_ai_now_hidden:${persona}`;
export const demoDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
export function hiddenToday(persona: string, day: string, store: () => Store = local) {
  try { return store().getItem(key(persona)) === day; } catch { return false; }
}
export function hideToday(persona: string, day: string, store: () => Store = local) {
  try { store().setItem(key(persona), day); } catch { /* not remembered */ }
}
