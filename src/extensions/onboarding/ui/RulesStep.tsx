"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Calculator, Check, Loader2, Pencil } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/app/display";
import { apiJson } from "@/components/app/forms/api";
import type { AutonomySuggestion, PolicySuggestion } from "../suggest";
import { ContinueButton, type StepProps } from "./Onboarding";

type Decision = "saved" | "kept";
const usd = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-US")}`);
const limits = (x: { limit: number | null; owner: number | null }) => `${!x.limit ? "always a person" : `auto up to ${usd(x.limit)}`}${x.owner == null ? "" : ` · owner above ${usd(x.owner)}`}`;
const LEVEL: Record<string, string> = { act_with_approval: "Approve first", auto_within_policy: "Auto within policy" };
const dollars = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[$,\s]/g, "")));
const SOURCE: Record<string, string> = { import: "imported units", stated: "units (your estimate)", workspace: "units in this workspace" };

function PolicyRow({ s, canEdit, decision, onSave, onKeep }: { s: PolicySuggestion; canEdit: boolean; decision?: Decision; onSave: (limit: number | null, owner: number | null) => Promise<boolean>; onKeep: () => void }) {
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(s.suggested.limit == null ? "" : String(s.suggested.limit));
  const [owner, setOwner] = useState(s.suggested.owner == null ? "" : String(s.suggested.owner));
  const [busy, setBusy] = useState(false);
  const bad = [limit, owner].some((x) => x.trim() !== "" && !(Number.isFinite(dollars(x)) && dollars(x)! >= 0));
  const run = async (l: number | null, o: number | null) => { setBusy(true); const ok = await onSave(l, o); setBusy(false); if (ok) setEditing(false); };
  const slug = s.category.toLowerCase().replace(/\s+/g, "-");
  return (
    <li className="flex flex-col gap-2 px-4 py-3.5" aria-labelledby={`pol-${slug}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={`pol-${slug}`} className="text-[13.5px] font-medium">{s.category}</h4>
        {decision === "saved" && <StatusBadge value="Saved" tone="success" />}
        {decision === "kept" && <StatusBadge value="Kept as is" tone="neutral" />}
        {!decision && !s.changed && <StatusBadge value="Already matches" tone="neutral" />}
      </div>
      <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-0.5 text-[12.5px] tabular-nums">
        <dt className="text-muted-foreground">Now</dt><dd>{limits(s.current)}</dd>
        {s.changed && <><dt className="text-muted-foreground">Suggested</dt><dd className="font-medium">{limits(s.suggested)}</dd></>}
      </dl>
      <p className="text-[12.5px] text-muted-foreground">{s.basis}</p>
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><Calculator className="size-3" aria-hidden />Computed from your records · {s.confidence} confidence ({formatNumber(s.sample)} records)</p>
      {editing ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!bad) void run(dollars(limit), dollars(owner)); }}>
          <label className="grid gap-1 text-[12px] text-muted-foreground">Auto-approve up to ($)<Input className="h-8 w-36" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Blank: always a person…" aria-invalid={bad || undefined} /></label>
          <label className="grid gap-1 text-[12px] text-muted-foreground">Owner approves above ($)<Input className="h-8 w-36" inputMode="decimal" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Blank: never…" aria-invalid={bad || undefined} /></label>
          <Button type="submit" size="sm" disabled={busy || bad}>{busy && <Loader2 className="animate-spin" />}Save {s.category.toLowerCase()}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          {bad && <p role="alert" className="basis-full text-[12px] text-tone-danger">Enter amounts in dollars, for example 1500.</p>}
        </form>
      ) : s.changed && !decision && canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void run(s.suggested.limit, s.suggested.owner)} aria-label={`Accept the suggested ${s.category.toLowerCase()} limit`}>{busy ? <Loader2 className="animate-spin" /> : <Check />}Accept</Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} aria-label={`Edit the ${s.category.toLowerCase()} limit`}><Pencil />Edit</Button>
          <Button size="sm" variant="ghost" onClick={onKeep}>Keep current</Button>
        </div>
      )}
    </li>
  );
}

function AgentRow({ a, canEdit, decision, onSave, onKeep }: { a: AutonomySuggestion; canEdit: boolean; decision?: Decision; onSave: () => Promise<boolean>; onKeep: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[13.5px] font-medium">{a.name}</h4>
        <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">{LEVEL[a.current]}{a.changed && <><ArrowRight className="size-3" aria-label="suggested" /><span className="font-medium text-foreground">{LEVEL[a.suggested]}</span></>}</span>
        {decision === "saved" && <StatusBadge value="Saved" tone="success" />}
        {decision === "kept" && <StatusBadge value="Kept as is" tone="neutral" />}
        {!decision && !a.changed && <StatusBadge value="Already matches" tone="neutral" />}
      </div>
      <p className="text-[12.5px] text-muted-foreground">{a.basis}</p>
      {a.changed && !decision && canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); await onSave(); setBusy(false); }} aria-label={`Accept ${LEVEL[a.suggested]} for ${a.name}`}>{busy ? <Loader2 className="animate-spin" /> : <Check />}Accept</Button>
          <Button size="sm" variant="ghost" onClick={onKeep}>Keep current</Button>
        </div>
      )}
    </li>
  );
}

export function RulesStep({ data, state, save, footer, complete }: StepProps) {
  const router = useRouter();
  const applied = new Set(state.rules?.applied ?? []);
  const [decided, setDecided] = useState<Record<string, Decision>>(() => Object.fromEntries([...applied].map((id) => [id, "saved" as const])));
  const [error, setError] = useState<string | null>(null);
  const st = data.stats;
  const canEdit = data.canEditPolicies;

  async function write(id: string, url: string, body: unknown) {
    setError(null);
    try {
      await apiJson("PATCH", url, body);
      setDecided((d) => ({ ...d, [id]: "saved" }));
      await save({ rules: { applied: [id] } });
      // "Now" shows the saved policy, read again from the server.
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  const keep = (id: string) => setDecided((d) => ({ ...d, [id]: "kept" }));
  const cents = (n: number | null) => (n == null ? null : Math.round(n * 100));
  const savedCount = Object.values(decided).filter((d) => d === "saved").length;

  return (
    <>
      <div className="flex flex-col gap-5 px-4 py-5 sm:px-5">
        <p className="rounded-md border bg-muted/30 px-3 py-2.5 text-[12.5px] text-muted-foreground">
          Sized from <span className="font-medium text-foreground tabular-nums">{formatNumber(st.units)} {SOURCE[st.unitsFrom]}</span>, {formatNumber(st.workOrders)} completed vendor work orders, {formatNumber(st.bills)} bills and {formatNumber(st.rents)} leases{st.unitsFrom === "import" ? "" : ". Work orders and bills don't come over in an import, so those are this workspace's sample data"}. These figures are computed by Propniti, not by a model.
        </p>
        {!canEdit && <p className="rounded-md border px-3 py-2 text-[12.5px] text-muted-foreground">Only a principal, regional manager or administrator with AI access changes approval policies and agent settings. You can read the suggestions; ask one of them to apply them.</p>}
        {error && <p role="alert" className="text-[12.5px] text-tone-danger">{error}</p>}

        <section aria-labelledby="onb-policies">
          <h3 id="onb-policies" className="mb-2 text-[13px] font-semibold">Approval limits</h3>
          <ul className="divide-y rounded-md border">
            {data.policies.map((s) => (
              <PolicyRow key={s.id} s={s} canEdit={canEdit} decision={decided[s.id]} onKeep={() => keep(s.id)}
                onSave={(limit, owner) => write(s.id, `/api/ai/policies/${encodeURIComponent(s.id)}`, { limit_cents: cents(limit), owner_approval_over_cents: cents(owner) })} />
            ))}
          </ul>
          {data.fixedPolicies.length > 0 && <p className="mt-2 text-[12px] text-muted-foreground">Not suggested: {data.fixedPolicies.join(", ")}. Legal and safety always need a person, and owner distributions stay as set in Settings › Approval policies.</p>}
        </section>

        <section aria-labelledby="onb-agents">
          <h3 id="onb-agents" className="mb-2 text-[13px] font-semibold">Agent autonomy</h3>
          <ul className="divide-y rounded-md border">
            {data.autonomy.map((a) => (
              <AgentRow key={a.key} a={a} canEdit={canEdit} decision={decided[`agent:${a.key}`]} onKeep={() => keep(`agent:${a.key}`)}
                onSave={() => write(`agent:${a.key}`, `/api/ai/agents/${a.key}`, { autonomy: a.suggested })} />
            ))}
          </ul>
        </section>
      </div>
      {footer(<ContinueButton onClick={() => void complete()}>{savedCount ? `Continue with ${savedCount} saved` : "Continue"}</ContinueButton>)}
    </>
  );
}
