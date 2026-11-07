import { Building2 } from "lucide-react";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { RelativeDate } from "@/components/app/display";
import { NoAccess, settingsSession } from "@/extensions/settings/pages";
import { orgId, one, prefsData } from "@/extensions/settings/data";
import { canEditCompany, canSettings } from "@/extensions/settings/nav";
import { CompanyForm, type CompanyProfile } from "@/extensions/settings/ui/forms";

export const metadata = { title: "Company profile · Propniti" };

// Shown until the principal or an admin saves the profile; matches the demo org's seeded name and HQ.
const DEFAULTS: CompanyProfile = {
  legal_name: "Summit Residential Partners, LLC", ein: "84-2719305", license_number: "TX 9011842",
  address: "600 Congress Ave, Suite 1400, Austin, TX 78701", phone: "(512) 555-0140",
  support_email: "residents@summitresidential.example", timezone: "America/Chicago", fiscal_year_start: "January",
};

export default async function CompanyPage() {
  const { session, ctx } = await settingsSession();
  if (!canSettings(session.actor.role)) return <NoAccess />;
  const [org, data, counts] = await Promise.all([
    one<{ name: string; plan: string; status: string; seats: number; units_managed: number; created_at: string }>(ctx, "SELECT name, plan, status, seats, units_managed, created_at FROM {orgs} WHERE id = ?", [orgId(ctx)]),
    prefsData(ctx, orgId(ctx)),
    one<{ props: number; units: number; staff: number; oes: number }>(ctx, "SELECT (SELECT count(*) FROM {properties}) AS props, (SELECT count(*) FROM {units}) AS units, (SELECT count(*) FROM {staff} WHERE active = 1) AS staff, (SELECT count(*) FROM {owner_entities}) AS oes"),
  ]);
  const profile = { ...DEFAULTS, ...((data.profile ?? {}) as Partial<CompanyProfile>) };
  const canEdit = canEditCompany(session.actor.role);
  const facts: [string, React.ReactNode][] = [
    ["Plan", `${org?.plan ?? "Enterprise"} · ${org?.status ?? "Active"}`],
    ["Seats", `${counts?.staff ?? 0} active of ${org?.seats ?? 0}`],
    ["Portfolio", `${counts?.props ?? 0} properties · ${(counts?.units ?? 0).toLocaleString("en-US")} units · ${counts?.oes ?? 0} owner entities`],
    ["Customer since", org?.created_at ? <RelativeDate value={org.created_at} mode="date" /> : "—"],
  ];
  return (
    <>
      <PageHeader icon={<Building2 />} title={org?.name ?? "Company profile"} description="The company details on owner statements, resident notices, 1099s and outgoing email." />
      <PageBody>
        <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-4 lg:grid-cols-4">
          {facts.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[12px] text-muted-foreground">{k}</dt><dd className="mt-0.5 truncate font-medium tabular-nums">{v}</dd></div>)}
        </dl>
        <Section title="Details" description={canEdit ? "Changes are audited." : "Read-only for your role. The principal and admins can change these."}>
          <div className="rounded-lg border bg-card p-4 md:p-5"><CompanyForm initial={profile} canEdit={canEdit} /></div>
        </Section>
      </PageBody>
    </>
  );
}
