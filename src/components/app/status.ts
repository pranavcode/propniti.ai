import type { Tone } from "@/entities/types";

// The one status → tone mapping (brief §5.1). An enum FieldDef can override per value; anything
// not listed is neutral. Keys are lower-case.
const TONES: Record<string, Tone> = {};
const set = (tone: Tone, words: string[]) => words.forEach((w) => (TONES[w] = tone));

set("success", ["paid", "active", "occupied", "current", "approved", "completed", "complete", "done", "signed", "reconciled", "passed", "pass", "verified", "fixed", "auto-fixed", "rent ready", "closed won", "leased", "succeeded", "healthy", "on track", "cleared", "posted", "compliant", "valid", "available"]);
set("warning", ["pending", "pending approval", "notice", "notice given", "due soon", "expiring", "expiring soon", "on hold", "partial", "partially paid", "review", "in review", "waiting", "waiting_approval", "needs review", "at risk", "proposed", "scheduled for move-out", "month-to-month", "medium", "warn", "make ready", "unverified", "awaiting vendor", "offered"]);
set("danger", ["overdue", "late", "failed", "fail", "eviction", "delinquent", "past due", "nsf", "rejected", "declined", "denied", "expired", "lapsed", "critical", "high", "past sla", "down", "breached", "error", "blocked", "fraud risk", "terminated", "cancelled", "canceled", "void"]);
set("info", ["scheduled", "in progress", "running", "open", "new", "assigned", "submitted", "sent", "queued", "future", "upcoming", "tour scheduled", "applied", "lead", "contacted", "processing", "draft sent"]);
set("neutral", ["draft", "vacant", "inactive", "archived", "dismissed", "low", "info", "closed", "none", "not started", "unassigned", "past", "former", "normal"]);
set("ai", ["ai-suggested", "ai suggested", "suggested", "auto_handled", "auto-handled", "auto handled", "precomputed", "live"]);

export function toneFor(value: unknown, overrides?: { value: string; tone: Tone }[]): Tone {
  if (value == null) return "neutral";
  const s = String(value);
  const hit = overrides?.find((o) => o.value === s);
  if (hit) return hit.tone;
  return TONES[s.toLowerCase()] ?? TONES[s.toLowerCase().replace(/_/g, " ")] ?? "neutral";
}

// Tailwind classes per tone (tinted pill, darker text). Literal strings so Tailwind sees them.
export const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-tone-neutral/10 text-tone-neutral ring-tone-neutral/15",
  info: "bg-tone-info/10 text-tone-info ring-tone-info/15",
  success: "bg-tone-success/10 text-tone-success ring-tone-success/15",
  warning: "bg-tone-warning/12 text-tone-warning ring-tone-warning/20",
  danger: "bg-tone-danger/10 text-tone-danger ring-tone-danger/15",
  ai: "bg-tone-ai/8 text-tone-ai ring-tone-ai/30",
};
export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-tone-neutral",
  info: "bg-tone-info",
  success: "bg-tone-success",
  warning: "bg-tone-warning",
  danger: "bg-tone-danger",
  ai: "bg-tone-ai",
};
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-tone-neutral",
  info: "text-tone-info",
  success: "text-tone-success",
  warning: "text-tone-warning",
  danger: "text-tone-danger",
  ai: "text-tone-ai",
};

// Sentence case for raw enum values: "pending_approval" → "Pending approval".
export function humanize(value: unknown): string {
  const s = String(value ?? "").replace(/[_-]+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : "";
}
