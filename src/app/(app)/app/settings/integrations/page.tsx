import { Banknote, CreditCard, Mail, Megaphone, MessageSquare, Plug, RefreshCcw } from "lucide-react";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { RelativeDate, StatusBadge } from "@/components/app/display";
import { NoAccess, settingsSession } from "@/extensions/settings/pages";
import { ORG_ID, prefsData, rows } from "@/extensions/settings/data";
import { canEditSettings, canSettings } from "@/extensions/settings/nav";
import { INTEGRATIONS } from "@/extensions/settings/integrations";
import { IntegrationToggle } from "@/extensions/settings/ui/forms";

export const metadata = { title: "Integrations · Propniti" };

const ICON: Record<string, React.ReactNode> = { plaid: <RefreshCcw />, bank_ach: <Banknote />, stripe: <CreditCard />, syndication: <Megaphone />, email: <Mail />, sms: <MessageSquare /> };
const TONE = { Connected: "success", "Needs attention": "warning", "Not connected": "neutral" } as const;

export default async function IntegrationsPage() {
  const { session, ctx } = await settingsSession();
  if (!canSettings(session.actor.role)) return <NoAccess />;
  const canEdit = canEditSettings(session.actor.role);
  const [prefs, banks] = await Promise.all([
    prefsData(ctx, ORG_ID),
    rows<{ id: string; name: string; kind: string; bank: string; last4: string }>(ctx, "SELECT id, name, kind, bank, last4 FROM {bank_accounts} ORDER BY kind, name LIMIT 50"),
  ]);
  const state = (prefs.integrations ?? {}) as Record<string, { status: string; at: string; by: string }>;
  const groups = [...new Set(INTEGRATIONS.map((i) => i.category))];
  return (
    <>
      <PageHeader icon={<Plug />} title="Integrations" description="Bank feeds, payments, listing syndication and messaging. In this demo connections are simulated: connecting records who did it and when, and no data leaves Propniti." />
      <PageBody>
        {groups.map((g) => (
          <Section key={g} title={g}>
            <ul className="grid gap-3 lg:grid-cols-2">
              {INTEGRATIONS.filter((i) => i.category === g).map((i) => {
                const s = state[i.key];
                const status = (s?.status ?? i.default) as keyof typeof TONE;
                return (
                  <li key={i.key} className="flex gap-3 rounded-lg border bg-card p-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground [&_svg]:size-4">{ICON[i.key]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{i.name}</span><StatusBadge value={status} tone={TONE[status] ?? "neutral"} /></div>
                      <p className="mt-0.5 text-[12.5px] text-muted-foreground">{i.description}</p>
                      {status !== "Not connected" && <p className="mt-1.5 text-[12px]">{i.key === "plaid" && banks.length ? `${banks.length} accounts at ${[...new Set(banks.map((b) => b.bank))].join(", ")}` : i.detail}</p>}
                      {s && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{s.status === "Connected" ? "Connected" : "Changed"} by {s.by} <RelativeDate value={s.at} /></p>}
                      {i.key === "plaid" && status === "Connected" && banks.length > 0 && (
                        <details className="mt-2 text-[12px]">
                          <summary className="cursor-pointer text-primary">{banks.length} linked accounts</summary>
                          <ul className="mt-1.5 grid gap-1">{banks.map((b) => <li key={b.id} className="flex justify-between gap-2"><span className="truncate">{b.name}</span><span className="shrink-0 text-muted-foreground tabular-nums">{b.bank} ··{b.last4}</span></li>)}</ul>
                        </details>
                      )}
                    </div>
                    <div className="shrink-0"><IntegrationToggle k={i.key} name={i.name} connected={status !== "Not connected"} canEdit={canEdit} /></div>
                  </li>
                );
              })}
            </ul>
          </Section>
        ))}
      </PageBody>
    </>
  );
}
