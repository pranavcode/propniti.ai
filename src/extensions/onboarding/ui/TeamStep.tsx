"use client";

import { useState } from "react";
import Link from "@/components/Link";
import { Info, Loader2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/app/display";
import { apiJson } from "@/components/app/forms/api";
import { useSetupProgress } from "@/components/app/onboarding/SetupChecklist";
import { ContinueButton, type StepProps } from "./Onboarding";

const EMPTY = { name: "", email: "", title: "", role: "property_manager", scope_kind: "property" as "org" | "region" | "property", scope_ids: [] as string[] };

export function TeamStep({ data, state, save, footer, complete }: StepProps) {
  const setup = useSetupProgress();
  const imported = data.properties.filter((p) => p.imported).map((p) => p.value);
  const demo = data.demoInvite && !data.team.some((t) => t.name === data.demoInvite!.name) ? data.demoInvite : null;
  const [v, setV] = useState({ ...EMPTY, ...demo, scope_ids: imported });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invited = state.team?.invited ?? [];
  const options = v.scope_kind === "region" ? data.regions : data.properties;
  const roleLabel = (r: string) => data.roles.find((x) => x.value === r)?.label ?? r;

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiJson<{ id: string }>("POST", "/app/settings/users/invite", v);
      await save({ team: { invited: [{ id: r.id, name: v.name.trim(), role: v.role }] } });
      setup.setDone("team", true);
      setV({ ...EMPTY, scope_ids: imported });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const active = data.team.filter((t) => t.status !== "Inactive");
  return (
    <>
      <div className="flex flex-col gap-5 px-4 py-5 sm:px-5">
        <p className="flex items-start gap-2 rounded-md border border-tone-info/30 bg-tone-info/[0.05] px-3 py-2.5 text-[12.5px]">
          <Info className="mt-0.5 size-3.5 shrink-0 text-tone-info" aria-hidden />
          {demo
            ? <span>Demo: the form is filled in for {demo.name}, a property manager. Add her with the properties she covers, then switch to her from your avatar menu to see just those properties. No email is sent. Everything resets at midnight Pacific.</span>
            : <span>Demo: people you add here are created in your private demo workspace only. No email is sent and they can&apos;t sign in. Everything resets at midnight Pacific.</span>}
        </p>

        {data.canInvite ? (
          <form onSubmit={invite} className="flex flex-col gap-3 rounded-md border p-4" aria-labelledby="onb-invite">
            <h3 id="onb-invite" className="text-[13px] font-semibold">Add a person</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-[12.5px]">Full name<Input name="name" autoComplete="off" required minLength={2} maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
              <label className="grid gap-1 text-[12.5px]">Work email<Input name="email" type="email" autoComplete="off" spellCheck={false} required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></label>
              <label className="grid gap-1 text-[12.5px]">Title<Input name="title" autoComplete="off" required minLength={2} maxLength={80} placeholder="Property manager…" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></label>
              <label className="grid gap-1 text-[12.5px]">Role
                <select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} className="h-9 rounded-md border bg-background px-2 text-[13px]">
                  {data.roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
            </div>
            <fieldset className="grid gap-2">
              <legend className="text-[12.5px]">Covers</legend>
              <div role="radiogroup" aria-label="Scope" className="flex flex-wrap gap-1.5">
                {([["org", "Whole company"], ["region", "Regions"], ["property", "Properties"]] as const).map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={v.scope_kind === k} onClick={() => setV({ ...v, scope_kind: k, scope_ids: k === "property" ? imported : [] })}
                    className={cn("h-8 rounded-md border px-3 text-[12.5px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50", v.scope_kind === k && "border-primary bg-primary/[0.08] text-primary")}>{label}</button>
                ))}
              </div>
              {v.scope_kind !== "org" && (
                <div className="max-h-48 overflow-y-auto rounded-md border p-1.5">
                  <div className="grid gap-0.5 sm:grid-cols-2">
                    {options.map((o) => {
                      const on = v.scope_ids.includes(o.value);
                      return (
                        <label key={o.value} className={cn("flex min-w-0 items-center gap-2 rounded px-2 py-1 text-[12.5px] hover:bg-muted", on && "bg-primary/5")}>
                          <input type="checkbox" checked={on} onChange={() => setV({ ...v, scope_ids: on ? v.scope_ids.filter((x) => x !== o.value) : [...v.scope_ids, o.value].slice(0, 30) })} className="accent-[var(--primary)]" />
                          <span className="truncate">{o.label}</span>
                          {v.scope_kind === "property" && imported.includes(o.value) && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">Imported</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </fieldset>
            {error && <p role="alert" className="text-[12.5px] text-tone-danger">{error}</p>}
            <div><Button type="submit" variant="outline" disabled={busy || (v.scope_kind !== "org" && !v.scope_ids.length)}>{busy ? <Loader2 className="animate-spin" /> : <UserPlus />}Add to team</Button></div>
          </form>
        ) : (
          <p className="rounded-md border px-3 py-2.5 text-[12.5px] text-muted-foreground">Only an administrator or the principal adds people and assigns roles, in <Link href="/app/settings/users" className="text-primary hover:underline">Settings › Users</Link>. Ask one of them; your progress here is kept.</p>
        )}

        {invited.length > 0 && (
          <section aria-labelledby="onb-added">
            <h3 id="onb-added" className="mb-2 text-[13px] font-semibold">Added during setup</h3>
            <ul className="divide-y rounded-md border">
              {invited.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                  <Link href={`/app/settings/users/${p.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary hover:underline">{p.name}</Link>
                  <span className="text-[12px] text-muted-foreground">{roleLabel(p.role)}</span>
                  <StatusBadge value="Invited" tone="info" />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="onb-team">
          <h3 id="onb-team" className="mb-2 text-[13px] font-semibold">Your team now · {active.length}</h3>
          <ul className="grid gap-x-4 sm:grid-cols-2">
            {active.slice(0, 12).map((t) => (
              <li key={t.id} className="flex min-w-0 items-baseline gap-2 border-b py-1.5 text-[12.5px]">
                <span className="truncate font-medium">{t.name}</span>
                <span className="truncate text-muted-foreground">{t.roles.join(", ") || t.title}</span>
              </li>
            ))}
          </ul>
          {active.length > 12 && <p className="mt-2 text-[12px] text-muted-foreground"><Link href="/app/settings/users" className="text-primary hover:underline">See all {active.length} people</Link></p>}
        </section>
      </div>
      {footer(<ContinueButton onClick={() => void complete()} />)}
    </>
  );
}
