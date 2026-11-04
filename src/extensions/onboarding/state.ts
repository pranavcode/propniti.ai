import { z } from "zod";
import type { Role } from "@/entities/types";

// Onboarding progress, kept as one JSON record in the org's settings (user_preferences.data
// "onboarding" under the org id) and merged patch by patch, so a person can leave at any step and
// resume there. Every step can be skipped.

export const STEPS = [
  { key: "company", label: "Company" },
  { key: "data", label: "Bring your data" },
  { key: "rules", label: "Rules" },
  { key: "team", label: "Team" },
  { key: "check", label: "Check" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];
const KEYS = STEPS.map((s) => s.key) as [StepKey, ...StepKey[]];

export const US_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"] as const;

const Company = z.strictObject({
  name: z.string().trim().min(1).max(120),
  states: z.array(z.enum(US_STATES)).max(US_STATES.length),
  size: z.number().int().min(0).max(1_000_000).nullable(),
});
const Import = z.strictObject({
  batch: z.string().regex(/^[0-9a-f]{10}$/),
  created: z.record(z.string().max(40), z.number().int().min(0)),
  tool: z.string().max(40),
  ai: z.boolean(),
});
const Check = z.strictObject({ issues: z.number().int().min(0), rules: z.number().int().min(0), at: z.string().max(40) });

export const OnboardingPatch = z.strictObject({
  at: z.enum(KEYS).optional(),
  done: z.array(z.enum(KEYS)).max(10).optional(),
  skipped: z.array(z.enum(KEYS)).max(10).optional(),
  company: Company.optional(),
  import: Import.nullable().optional(),
  // Ids of the policies and agents whose suggestion was saved: "pol-…" or "agent:<key>".
  rules: z.strictObject({ applied: z.array(z.string().max(80)).max(40) }).optional(),
  team: z.strictObject({ invited: z.array(z.strictObject({ id: z.string().max(40), name: z.string().max(80), role: z.string().max(40) })).max(30) }).optional(),
  check: Check.optional(),
});
export type OnboardingPatch = z.infer<typeof OnboardingPatch>;
export type OnboardingState = Omit<OnboardingPatch, "done" | "skipped"> & { done: StepKey[]; skipped: StepKey[] };

export const EMPTY: OnboardingState = { done: [], skipped: [] };

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

export function applyPatch(s: OnboardingState, p: OnboardingPatch): OnboardingState {
  const done = uniq([...s.done, ...(p.done ?? [])]);
  return {
    ...s, ...p,
    done,
    skipped: uniq([...s.skipped, ...(p.skipped ?? [])]).filter((k) => !done.includes(k)),
    rules: p.rules ? { applied: uniq([...(s.rules?.applied ?? []), ...p.rules.applied]).slice(0, 40) } : s.rules,
    team: p.team ? { invited: [...(s.team?.invited ?? []), ...p.team.invited].slice(0, 30) } : s.team,
  };
}

// A stored record that no longer parses (an older shape) starts over rather than failing the page.
export function parseState(v: unknown): OnboardingState {
  const r = OnboardingPatch.safeParse(v ?? {});
  return r.success ? applyPatch(EMPTY, r.data) : EMPTY;
}

export const resumeStep = (s: OnboardingState): StepKey => s.at ?? KEYS.find((k) => !s.done.includes(k) && !s.skipped.includes(k)) ?? "check";

const at = (k: StepKey) => KEYS.indexOf(k);
export const nextStep = (k: StepKey): StepKey | null => KEYS[at(k) + 1] ?? null;
export const prevStep = (k: StepKey): StepKey | null => (at(k) > 0 ? KEYS[at(k) - 1]! : null);

// The sidebar setup checklist items (SETUP_ITEMS keys) a finished step completes.
const SETUP: Record<StepKey, string[]> = { company: ["company"], data: ["import"], rules: ["payments"], team: ["roles", "team"], check: [] };
export const setupKeysFor = (k: StepKey) => SETUP[k];

// Who runs onboarding: the people who set the org up. Each step still applies its own route's
// permission check (imports, approval policies, agent settings, invites).
export const ONBOARD_ROLES: Role[] = ["principal", "regional_manager", "admin"];
export const canOnboard = (role: Role) => ONBOARD_ROLES.includes(role);
