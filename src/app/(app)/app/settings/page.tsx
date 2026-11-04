import Link from "next/link";
import { Settings } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page";
import { settingsSession } from "@/extensions/settings/pages";
import { ORG_ID, one, prefsData } from "@/extensions/settings/data";
import { canSettings, settingsNav } from "@/extensions/settings/nav";
import { INTEGRATIONS } from "@/extensions/settings/integrations";

export const metadata = { title: "Settings · Propniti" };

type Counts = { active: number; invited: number; policies: number; overrides: number; rules: number; audit7: number; ai7: number; banks: number };

export default async function SettingsHome() {
  const { session, ctx } = await settingsSession();
  const role = session.actor.role;
  const org = canSettings(role);
  const [c, prefs] = org
    ? await Promise.all([
      one<Counts>(ctx, `SELECT
        (SELECT count(*) FROM {staff} WHERE active = 1) AS active,
        (SELECT count(*) FROM {staff} WHERE active = 0 AND last_active_at IS NULL) AS invited,
        (SELECT count(*) FROM {approval_policies} WHERE owner_entity_id IS NULL) AS policies,
        (SELECT count(*) FROM {approval_policies} WHERE owner_entity_id IS NOT NULL) AS overrides,
        (SELECT count(DISTINCT state || rule) FROM {state_rules}) AS rules,
        (SELECT count(*) FROM {audit} WHERE at >= date($AS_OF, '-7 days')) AS audit7,
        (SELECT count(*) FROM {audit} WHERE agent IS NOT NULL AND at >= date($AS_OF, '-7 days')) AS ai7,
        (SELECT count(*) FROM {bank_accounts}) AS banks`),
      prefsData(ctx, ORG_ID),
    ])
    : [null, {}];
  const integ = (prefs as { integrations?: Record<string, { status: string }> }).integrations ?? {};
  const connected = INTEGRATIONS.filter((i) => (integ[i.key]?.status ?? i.default) === "Connected").length;
  const attention = INTEGRATIONS.filter((i) => (integ[i.key]?.status ?? i.default) === "Needs attention").length;
  const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");
  const hint: Record<string, string> = c ? {
    "/app/settings/users": `${n(c.active)} active${c.invited ? ` · ${n(c.invited)} invites pending` : ""}`,
    "/app/settings/roles": "13 roles, generated from what the API enforces",
    "/app/settings/integrations": `${connected} of ${INTEGRATIONS.length} connected${attention ? ` · ${attention} need attention` : ""}`,
    "/app/settings/approvals": `${n(c.policies)} org defaults · ${n(c.overrides)} owner overrides`,
    "/app/settings/state-rules": `${n(c.rules)} rules across TX, GA and AZ`,
    "/app/automations": "What agents run on their own, when, and under which rules",
    "/app/settings/audit": `${n(c.audit7)} entries this week · ${n(c.ai7)} by agents`,
    "/app/settings/payments": "Management fee, late fees and payment methods",
    "/app/settings/company": "Legal name, EIN, address and time zone",
    "/app/settings/ai": "Model, agent autonomy and data use",
    "/app/settings/import": "Properties and units from a rent roll",
  } : {};
  hint["/app/settings/notifications"] = "What reaches you, and where";
  return (
    <>
      <PageHeader icon={<Settings />} title="Settings" description={org ? "Organization configuration, policies the agents follow, and your own preferences." : "Your own preferences. Org settings are managed by your administrator."} />
      <PageBody>
        {settingsNav(role).map((g) => (
          <section key={g.label}>
            <h2 className="mb-2 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">{g.label}</h2>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((i) => (
                <li key={i.href}>
                  <Link href={i.href} className="block rounded-lg border bg-card px-3.5 py-3 transition-colors hover:border-primary/40 hover:bg-primary/[0.02]">
                    <div className="font-medium">{i.label}</div>
                    <div className="mt-0.5 text-[12.5px] text-muted-foreground tabular-nums">{hint[i.href] ?? " "}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </PageBody>
    </>
  );
}
