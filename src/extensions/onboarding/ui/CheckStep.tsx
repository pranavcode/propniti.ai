"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/Link";
import { ArrowRight, CircleCheck, HeartPulse, Loader2, Wrench } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/display";
import { apiJson } from "@/components/app/forms/api";
import type { CheckResult } from "../server";
import { createdText } from "./DataStep";
import { type StepProps } from "./Onboarding";

const SEVERITY: Record<string, { label: string; tone: "danger" | "warning" | "info" }> = { critical: { label: "Critical", tone: "danger" }, warn: { label: "Warning", tone: "warning" }, info: { label: "Info", tone: "info" } };

function Tile({ title, value, detail, href, cta }: { title: string; value: string; detail: string; href: string; cta: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-background p-3.5">
      <div className="text-[12px] text-muted-foreground">{title}</div>
      <div className="text-[15px] font-semibold tabular-nums">{value}</div>
      <div className="text-[12px] text-muted-foreground">{detail}</div>
      <Link href={href} className="mt-auto inline-flex items-center gap-1 pt-1 text-[12.5px] text-primary hover:underline">{cta}<ArrowRight className="size-3" aria-hidden /></Link>
    </div>
  );
}

export function CheckStep({ data, state, save, footer }: StepProps) {
  const router = useRouter();
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imp = state.import;

  async function run() {
    if (!imp) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await apiJson<CheckResult>("POST", "/api/onboarding/check", { batch: imp.batch }));
      await save({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    const ok = await save({ done: ["check"] });
    setBusy(false);
    if (ok) router.push("/app");
  }

  const issues = result?.issues.length ?? state.check?.issues ?? null;
  const withFix = result?.issues.filter((i) => i.fix).length;
  const applied = state.rules?.applied ?? [];
  const policies = applied.filter((x) => !x.startsWith("agent:")).length;
  const agents = applied.length - policies;
  const invited = state.team?.invited.length ?? 0;
  const checked = !!result || !!state.check;

  return (
    <>
      <div className="flex flex-col gap-5 px-4 py-5 sm:px-5">
        <section aria-labelledby="onb-health" className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex items-start gap-3">
            <HeartPulse className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <h3 id="onb-health" className="text-[13px] font-semibold">Data Health on your imported records</h3>
              <p className="text-[12.5px] text-muted-foreground">
                {imp ? "Runs the same rules as the Data Health page (duplicates, missing ZIP or state, rents far above market, leases ending before they start and more) over the records from your import. Each problem is filed as an issue with a suggested fix when the rule has one; nothing is changed until a person applies it." : "Nothing was imported during setup, so there's nothing new to check. Data Health checks all your records every morning."}
              </p>
            </div>
          </div>
          {imp && (
            <div>
              <Button variant={checked ? "outline" : "default"} onClick={() => void run()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <HeartPulse />}{checked ? "Run the checks again" : "Run the checks"}</Button>
            </div>
          )}
          {error && <p role="alert" className="text-[12.5px] text-tone-danger">{error}</p>}
          {result && (
            <div className="flex flex-col gap-2" data-testid="check-result">
              <p className="text-[12.5px] tabular-nums" role="status">
                {result.issues.length ? `${formatNumber(result.rules)} rules found ${result.issues.length === 1 ? "1 issue" : `${formatNumber(result.issues.length)} issues`}, ${formatNumber(withFix ?? 0)} with a suggested fix.` : `${formatNumber(result.rules)} rules ran. No issues in the imported records.`}
              </p>
              {result.issues.length > 0 && (
                <ul className="divide-y rounded-md border">
                  {result.issues.slice(0, 12).map((i) => (
                    <li key={i.id} className="flex flex-col gap-1 px-3 py-2.5 text-[12.5px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge value={SEVERITY[i.severity]?.label ?? i.severity} tone={SEVERITY[i.severity]?.tone ?? "neutral"} />
                        <span className="font-medium">{i.name}</span>
                        <span className="text-muted-foreground">·</span>
                        {i.href ? <Link href={i.href} className="text-primary hover:underline">{i.label}</Link> : <span>{i.label}</span>}
                      </div>
                      <p className="flex items-start gap-1.5 text-muted-foreground"><Wrench className="mt-0.5 size-3 shrink-0" aria-hidden />{i.fix ? `Suggested fix: ${i.fix}` : "No automatic fix for this rule; open the record to correct it."}</p>
                    </li>
                  ))}
                </ul>
              )}
              {result.issues.length > 0 && <Link href="/app/data-health" className="inline-flex items-center gap-1 text-[12.5px] text-primary hover:underline">Review and apply fixes in Data Health<ArrowRight className="size-3" aria-hidden /></Link>}
            </div>
          )}
        </section>

        <section aria-labelledby="onb-ready" className="flex flex-col gap-3">
          <h3 id="onb-ready" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><CircleCheck className="size-4 text-tone-success" aria-hidden />{state.company?.name ? `${state.company.name}: your portfolio is ready` : "Your portfolio is ready"}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="onboarding-summary">
            <Tile title="Imported" value={imp ? formatNumber(Object.values(imp.created).reduce((s, n) => s + n, 0)) + " records" : "Nothing yet"} detail={imp ? createdText(imp.created) : "Bring data over any time from Settings › Import data."} href={imp ? data.routes.properties ?? "/app/settings/import" : "/app/settings/import"} cta={imp ? "See properties" : "Import data"} />
            <Tile title="Data issues" value={issues == null ? "Not checked" : issues === 1 ? "1 found" : `${formatNumber(issues)} found`} detail={issues ? `${withFix != null ? `${formatNumber(withFix)} with a suggested fix. ` : ""}Each waits for a person to apply it.` : checked ? "The imported records passed every rule." : "Run the checks above."} href="/app/data-health" cta="Open Data Health" />
            <Tile title="Rules set" value={applied.length === 1 ? "1 change" : `${formatNumber(applied.length)} changes`} detail={`${formatNumber(policies)} approval ${policies === 1 ? "limit" : "limits"}, ${formatNumber(agents)} agent ${agents === 1 ? "setting" : "settings"}. Legal and safety always need a person.`} href="/app/settings/approvals" cta="Approval policies" />
            <Tile title="Team" value={invited === 1 ? "1 added" : `${formatNumber(invited)} added`} detail={`${formatNumber(data.team.filter((t) => t.status === "Active").length)} active people in the workspace.`} href="/app/settings/users" cta="Users and roles" />
          </div>
          {state.company && <p className="text-[12.5px] text-muted-foreground">{state.company.name}{state.company.states.length ? ` · operating in ${state.company.states.join(", ")}` : ""}{state.company.size ? ` · about ${formatNumber(state.company.size)} units` : ""}. Add the EIN, address and support email in <Link href="/app/settings/company" className="text-primary hover:underline">Company profile</Link>.</p>}
        </section>
      </div>
      {footer(<Button onClick={() => void finish()} disabled={busy}>Finish and go to the dashboard <ArrowRight /></Button>)}
    </>
  );
}
