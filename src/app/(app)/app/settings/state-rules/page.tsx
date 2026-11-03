import Link from "next/link";
import { Landmark } from "lucide-react";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { RelativeDate } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { list } from "@/server/query";
import { STATE_RULES } from "@/entities/defs/settings";
import { ChangeHistory } from "@/extensions/settings/History";
import { NoAccess, settingsSession } from "@/extensions/settings/pages";
import { canEditSettings, canSettings } from "@/extensions/settings/nav";
import { AmendRule } from "@/extensions/settings/ui/forms";

export const metadata = { title: "State rules · Propniti" };

const STATES: Record<string, string> = { TX: "Texas", GA: "Georgia", AZ: "Arizona" };
type R = { id: string; state: string; rule: keyof typeof STATE_RULES; value: string; note: string; effective_from: string; current: boolean; changed_by__label?: string | null; title: string };

function show(r: R) {
  const meta = STATE_RULES[r.rule];
  const n = Number(r.value);
  if (!meta) return r.value;
  if (n === 0) return meta.zeroMeans;
  if (r.rule === "late_fee_cap_cents") return `$${(n / 100).toLocaleString("en-US")}`;
  return `${r.value} ${meta.unit}`;
}

export default async function StateRulesPage() {
  const { session, ctx } = await settingsSession();
  if (!canSettings(session.actor.role)) return <NoAccess />;
  const canEdit = canEditSettings(session.actor.role);
  const res = await list(ctx, "state_rules", { size: 100, sort: ["effective_from", "desc"] });
  const all = res.rows as unknown as R[];
  const versions = (r: R) => all.filter((x) => x.state === r.state && x.rule === r.rule);
  const ruleKeys = Object.keys(STATE_RULES).filter((k) => all.some((r) => r.rule === k)) as (keyof typeof STATE_RULES)[];
  return (
    <>
      <PageHeader icon={<Landmark />} title="State rules" description="Late-fee caps, grace periods, deposit limits and notice periods by state. Late fees post capped by the rule in force on the posting date, and the Collections agent quotes these in notices. Plain-English summaries, not legal advice: confirm changes with counsel." />
      <PageBody>
        {!all.length ? (
          <EmptyState kind="table" title="No state rules yet" description="Add the rules for Texas, Georgia and Arizona before posting late fees. Until then late fees use each property's late-fee policy without a state cap." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-3">
            {Object.keys(STATES).filter((s) => all.some((r) => r.state === s)).map((s) => (
              <Section key={s} title={STATES[s]} description={`${all.filter((r) => r.state === s && r.current).length} rules in force`} className="rounded-lg border bg-card p-4">
                <dl className="divide-y">
                  {ruleKeys.map((k) => {
                    const cur = all.find((r) => r.state === s && r.rule === k && r.current);
                    if (!cur) return null;
                    const v = versions(cur);
                    return (
                      <div key={k} className="py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <dt className="text-[12px] text-muted-foreground">{STATE_RULES[k].label}</dt>
                          {canEdit && <AmendRule id={cur.id} title={`${STATES[s]} ${STATE_RULES[k].label.toLowerCase()}`} value={cur.value} unit={STATE_RULES[k].unit} note={cur.note} minDate={cur.effective_from} />}
                        </div>
                        <dd className="text-[14px] font-medium tabular-nums">
                          <Link href={`/app/settings/state-rules/${encodeURIComponent(cur.id)}`} className="hover:text-primary hover:underline">{show(cur)}</Link>
                        </dd>
                        <dd className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{cur.note}</dd>
                        <dd className="mt-1 text-[11.5px] text-muted-foreground">
                          Since <RelativeDate value={cur.effective_from} mode="date" />
                          {v.length > 1 && <> · was {show(v[1])} from <RelativeDate value={v[1].effective_from} mode="date" /></>}
                          {cur.changed_by__label && <> · set by {cur.changed_by__label}</>}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </Section>
            ))}
          </div>
        )}
        <Section title="Change history" description="Each amendment is a new dated version; earlier versions still apply to charges before their end date.">
          <ChangeHistory ctx={ctx} entityTypes={["state_rules"]} empty="Amendments to state rules appear here with who made them." />
        </Section>
        {all.length > 0 && (
          <Section title="All versions" description={`${all.length} versions across ${Object.keys(STATES).length} states, newest first.`}>
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                  <tr><th className="px-3 py-2 font-medium">Rule</th><th className="px-3 py-2 font-medium">Value</th><th className="px-3 py-2 font-medium">Effective from</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Changed by</th></tr>
                </thead>
                <tbody>
                  {all.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-1.5"><Link href={`/app/settings/state-rules/${encodeURIComponent(r.id)}`} className="hover:text-primary hover:underline">{r.title}</Link></td>
                      <td className="px-3 py-1.5 tabular-nums">{show(r)}</td>
                      <td className="px-3 py-1.5 tabular-nums"><RelativeDate value={r.effective_from} mode="date" /></td>
                      <td className="px-3 py-1.5">{r.current ? <span className="text-tone-success">In force</span> : r.effective_from > (all.find((x) => x.state === r.state && x.rule === r.rule && x.current)?.effective_from ?? "") ? <span className="text-tone-info">Scheduled</span> : <span className="text-muted-foreground">Superseded</span>}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.changed_by__label ?? "Seeded"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </PageBody>
    </>
  );
}
