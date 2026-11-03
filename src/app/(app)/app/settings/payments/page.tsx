import Link from "next/link";
import { Lock, Percent } from "lucide-react";
import { MANAGEMENT_FEE_RATE } from "@/lib/ledger";
import { formatMoney } from "@/lib/format";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { Money } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { NoAccess, settingsSession } from "@/extensions/settings/pages";
import { ORG_ID, prefsData, rows } from "@/extensions/settings/data";
import { canSettings } from "@/extensions/settings/nav";
import { INTEGRATIONS } from "@/extensions/settings/integrations";

export const metadata = { title: "Fees and payments · Propniti" };

type Policy = { id: string; property_id: string | null; property: string | null; state: string | null; grace_days: number; kind: string; flat_cents: number; pct: number; daily_cents: number; max_cents: number | null };

// Same arithmetic as postLateFees in src/server/money.ts, shown for one example rent.
function exampleFee(p: Policy, rentCents: number, capPct: number) {
  let fee = p.kind === "Percent" ? Math.floor((rentCents * p.pct + 50) / 100) : p.kind === "Flat" ? p.flat_cents : p.flat_cents + p.daily_cents * 4;
  if (p.max_cents != null) fee = Math.min(fee, p.max_cents);
  const capped = capPct > 0 && fee > Math.floor((rentCents * capPct + 50) / 100);
  if (capped) fee = Math.floor((rentCents * capPct + 50) / 100);
  return { fee, capped };
}
const usd = (cents: number) => formatMoney(cents / 100, "whole");
const describe = (p: Policy) => p.kind === "Percent" ? `${p.pct}% of rent` : p.kind === "Flat" ? `${usd(p.flat_cents)} flat` : `${usd(p.flat_cents)} + ${usd(p.daily_cents)}/day`;

export default async function PaymentsPage() {
  const { session, ctx } = await settingsSession();
  if (!canSettings(session.actor.role)) return <NoAccess />;
  const [policies, caps, prefs] = await Promise.all([
    rows<Policy>(ctx, "SELECT l.id, l.property_id, p.name AS property, p.state, l.grace_days, l.kind, l.flat_cents, l.pct, l.daily_cents, l.max_cents FROM {late_fee_policies} l LEFT JOIN {properties} p ON p.id = l.property_id ORDER BY l.property_id IS NOT NULL, p.name LIMIT 100"),
    rows<{ state: string; value: string }>(ctx, "SELECT s.state, s.value FROM {state_rules} s WHERE s.rule = 'late_fee_cap_pct' AND s.effective_from = (SELECT max(x.effective_from) FROM {state_rules} x WHERE x.state = s.state AND x.rule = s.rule AND x.effective_from <= $AS_OF)"),
    prefsData(ctx, ORG_ID),
  ]);
  const capOf = (state: string | null) => Number(caps.find((c) => c.state === state)?.value ?? 0);
  const integ = (prefs.integrations ?? {}) as Record<string, { status?: string }>;
  const stripe = integ.stripe?.status ?? INTEGRATIONS.find((i) => i.key === "stripe")!.default;
  const RENT = 150_000;
  return (
    <>
      <PageHeader icon={<Percent />} title="Fees and payments" description="The management fee, late-fee policies and how residents pay. Late fees are capped by the state rule in force when they post." />
      <PageBody>
        <Section title="Management fee">
          <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
            <div className="text-[28px] leading-none font-semibold tabular-nums">{Math.round(MANAGEMENT_FEE_RATE * 100)}%</div>
            <div className="min-w-0 flex-1 text-[13px]">
              <div className="font-medium">Of rent collected, deducted before owner distributions</div>
              <div className="text-muted-foreground">On $1,500 collected the owner receives <Money value={1500 * (1 - MANAGEMENT_FEE_RATE)} /> and the fee is <Money value={1500 * MANAGEMENT_FEE_RATE} />. Owner statements, distributions and the ledger all use this one rate.</div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[12px] text-muted-foreground"><Lock className="size-3" />Set by your management agreement; contact support to change it</span>
          </div>
        </Section>

        <Section title="Late-fee policies" description="Example fee on $1,500 rent, 5 days past grace. The state cap applies after the policy maximum." actions={<Link href="/app/settings/state-rules" className="text-[12.5px] text-primary hover:underline">State rules</Link>}>
          {!policies.length ? (
            <EmptyState compact kind="table" title="No late-fee policies yet" description="Without a policy, late fees post at $50 after a 3-day grace period, capped by the state rule." />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                  <tr><th className="px-3 py-2 font-medium">Applies to</th><th className="px-3 py-2 font-medium">Fee</th><th className="px-3 py-2 text-right font-medium">Grace</th><th className="px-3 py-2 text-right font-medium">Policy max</th><th className="px-3 py-2 text-right font-medium">State cap</th><th className="px-3 py-2 text-right font-medium">Example fee</th></tr>
                </thead>
                <tbody>
                  {policies.map((p) => {
                    const cap = capOf(p.state);
                    const ex = exampleFee(p, RENT, cap);
                    return (
                      <tr key={p.id} className="border-t">
                        <td className="px-3 py-1.5">{p.property_id ? <Link href={`/app/properties/${p.property_id}`} className="hover:text-primary hover:underline">{p.property ?? p.property_id}</Link> : <span className="font-medium">Org default</span>}{p.state && <span className="ml-1.5 text-[11.5px] text-muted-foreground">{p.state}</span>}</td>
                        <td className="px-3 py-1.5">{describe(p)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{p.grace_days} days</td>
                        <td className="px-3 py-1.5 text-right">{p.max_cents == null ? <span className="text-muted-foreground">None</span> : <Money value={p.max_cents} cents style="whole" />}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{p.state ? (cap > 0 ? `${cap}%` : "None") : "By property"}</td>
                        <td className="px-3 py-1.5 text-right"><Money value={ex.fee} cents />{ex.capped && <span className="ml-1.5 text-[11px] text-tone-warning">capped</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="How residents pay" actions={<Link href="/app/settings/integrations" className="text-[12.5px] text-primary hover:underline">Integrations</Link>}>
          <ul className="grid gap-3 md:grid-cols-3">
            {[
              ["Bank transfer (ACH)", "Free for residents. Settles in 2–3 business days; returns (NSF) reverse the payment and can post a fee.", "Always on"],
              ["Card", "2.9% + 30¢ passed to the resident. Settles next business day.", stripe === "Connected" ? "On" : "Off: connect Stripe"],
              ["Autopay", "Residents opt in from the portal; runs on the due date, skips if a payment plan is active.", stripe === "Connected" ? "On" : "Off: connect Stripe"],
            ].map(([t, d, s]) => (
              <li key={t} className="rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{t}</span><span className={s.startsWith("Off") ? "text-[12px] text-tone-warning" : "text-[12px] text-tone-success"}>{s}</span></div>
                <p className="mt-1 text-[12.5px] text-muted-foreground">{d}</p>
              </li>
            ))}
          </ul>
        </Section>
      </PageBody>
    </>
  );
}
