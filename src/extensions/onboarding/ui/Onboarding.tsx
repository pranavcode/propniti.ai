"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { apiJson } from "@/components/app/forms/api";
import { useSetupProgress } from "@/components/app/onboarding/SetupChecklist";
import type { WizardOptions } from "@/extensions/import/ui/ImportWizard";
import { nextStep, oneAtATime, prevStep, resumeStep, setupKeysFor, STEPS, type OnboardingPatch, type OnboardingState, type StepKey } from "../state";
import type { AutonomySuggestion, PolicySuggestion, Stats } from "../suggest";
import { CompanyStep } from "./CompanyStep";
import { DataStep } from "./DataStep";
import { RulesStep } from "./RulesStep";
import { TeamStep } from "./TeamStep";
import { CheckStep } from "./CheckStep";

// /app/onboarding: five steps, each skippable, with progress saved to the org's settings on every
// move so the flow resumes where it was left. The steps reuse the existing import wizard, policy
// and agent routes, user invites and Data Health rules, each with its own permission check.

export type Option = { value: string; label: string };
export type OnboardingData = {
  state: OnboardingState;
  defaultName: string;
  options: WizardOptions;
  canImportProperties: boolean;
  canEditPolicies: boolean;
  canInvite: boolean;
  setupKeys: string[]; // checklist items this role can tick

  stats: { units: number; unitsFrom: Stats["unitsFrom"]; workOrders: number; bills: number; rents: number };
  policies: PolicySuggestion[];
  fixedPolicies: string[];
  autonomy: AutonomySuggestion[];
  team: { id: string; name: string; title: string; status: string; roles: string[] }[];
  roles: Option[];
  regions: Option[];
  properties: (Option & { imported: boolean })[];
  routes: Record<string, string>;
  // A demo person the visitor can invite and then sign in as (Lakeside's property manager).
  demoInvite?: { name: string; email: string; title: string; role: string };
};

const COPY: Record<StepKey, { title: string; description: string }> = {
  company: { title: "Your company", description: "The name on statements and notices, where you operate, and roughly how big the portfolio is. Saved to your org settings." },
  data: { title: "Bring your data", description: "Drop the exports from your current tool, in any mix. Each file's source and contents are identified first; then columns, checks, preview, import and undo work as in Settings › Import data. Nothing is saved until you confirm the preview." },
  rules: { title: "Approval rules", description: "Limits and agent autonomy sized to your portfolio, computed from your records. Accept, edit or keep each one. Legal and safety decisions always stay with a person." },
  team: { title: "Your team", description: "Add the people who work the portfolio, each with a role and the properties they cover." },
  check: { title: "Check and finish", description: "Data Health runs its rules over the records you imported, then you get a summary of what's set up." },
};

export type StepProps = {
  data: OnboardingData;
  state: OnboardingState;
  save: (patch: OnboardingPatch) => Promise<OnboardingState | null>;
  footer: (primary: React.ReactNode) => React.ReactNode;
  complete: (patch?: OnboardingPatch) => Promise<void>;
};

export function Onboarding({ data }: { data: OnboardingData }) {
  const [state, setState] = useState(data.state);
  const [step, setStep] = useState<StepKey>(() => resumeStep(data.state));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setup = useSetupProgress();
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const queue = useRef(oneAtATime()).current;

  // Focus the new step's heading after a move (not on first load), so screen readers announce it.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [step]);

  async function save(patch: OnboardingPatch) {
    setError(null);
    try {
      const r = await queue(() => apiJson<{ state: OnboardingState }>("POST", "/api/onboarding", patch));
      setState(r.state);
      for (const k of patch.done ?? []) for (const key of setupKeysFor(k)) if (data.setupKeys.includes(key)) setup.setDone(key, true);
      return r.state;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }

  async function go(to: StepKey, patch: OnboardingPatch = {}) {
    setBusy(true);
    const ok = await save({ ...patch, at: to });
    setBusy(false);
    if (!ok) return;
    moved.current = true;
    setStep(to);
    window.scrollTo({ top: 0 });
  }

  const next = nextStep(step);
  const prev = prevStep(step);
  const complete = (patch: OnboardingPatch = {}) => go(next ?? step, { ...patch, done: [...(patch.done ?? []), step] });
  const at = STEPS.findIndex((s) => s.key === step);

  const footer = (primary: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 sm:px-5">
      {prev && <Button variant="ghost" disabled={busy} onClick={() => go(prev)}><ArrowLeft /> Back</Button>}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {next && <Button variant="ghost" disabled={busy} onClick={() => go(next, { skipped: [step] })}>Skip this step</Button>}
        {busy ? <Button disabled><Loader2 className="animate-spin" /> Saving…</Button> : primary}
      </div>
    </div>
  );
  const props: StepProps = { data, state, save, footer, complete };
  const status = (k: StepKey) => (state.done.includes(k) ? "done" : state.skipped.includes(k) ? "skipped" : null);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Setup steps" className="max-lg:hidden">
        <ol className="flex flex-col gap-0.5">
          {STEPS.map((s, i) => {
            const st = status(s.key);
            return (
              <li key={s.key}>
                <button type="button" onClick={() => s.key !== step && go(s.key)} disabled={busy} aria-current={s.key === step ? "step" : undefined}
                  className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50", s.key === step && "bg-muted font-medium")}>
                  <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] tabular-nums", st === "done" ? "border-primary bg-primary text-primary-foreground" : s.key === step ? "border-primary text-primary" : "text-muted-foreground")}>
                    {st === "done" ? <Check className="size-3.5" strokeWidth={3} /> : st === "skipped" ? <Minus className="size-3.5" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{s.label}</span>
                    {st && <span className="block text-[11.5px] font-normal text-muted-foreground">{st === "done" ? "Done" : "Skipped"}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 px-2 text-[12px] text-muted-foreground">Progress is saved as you go. Leave any time and pick up where you stopped.</p>
      </nav>

      <section aria-labelledby="onb-title" className="min-w-0 rounded-lg border bg-card">
        <header className="border-b px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
            <span>Step {at + 1} of {STEPS.length}</span>
            <span className="lg:hidden">{STEPS.filter((s) => status(s.key)).length} of {STEPS.length} done or skipped</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted lg:hidden" aria-hidden><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${((at + 1) / STEPS.length) * 100}%` }} /></div>
          <h2 id="onb-title" ref={heading} tabIndex={-1} className="mt-2 text-[16px] font-semibold tracking-tight outline-none">{COPY[step].title}</h2>
          <p className="mt-1 max-w-[70ch] text-[13px] text-muted-foreground">{COPY[step].description}</p>
          {error && <p role="alert" className="mt-3 rounded-md border border-tone-danger/30 bg-tone-danger/[0.05] px-3 py-2 text-[12.5px] text-tone-danger">{error}</p>}
        </header>
        {step === "company" && <CompanyStep {...props} />}
        {step === "data" && <DataStep {...props} />}
        {step === "rules" && <RulesStep {...props} />}
        {step === "team" && <TeamStep {...props} />}
        {step === "check" && <CheckStep {...props} />}
      </section>
    </div>
  );
}

export const ContinueButton = ({ onClick, disabled, children = "Continue" }: { onClick: () => void; disabled?: boolean; children?: React.ReactNode }) => (
  <Button onClick={onClick} disabled={disabled}>{children} <ArrowRight /></Button>
);
