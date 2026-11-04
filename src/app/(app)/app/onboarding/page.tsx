import type { Metadata } from "next";
import { Rocket } from "lucide-react";
import { currentSession } from "@/auth/session";
import { PERSONAS } from "@/auth/personas";
import { getEntity, INTERNAL_ROLES } from "@/entities";
import { getPlatform } from "@/lib/platform";
import { PageBody, PageHeader } from "@/components/app/page";
import { allAgents, AGENT_ORDER } from "@/ai/agents";
import { agentName } from "@/ai/ui/labels";
import { canEditPolicies } from "@/ai/policy-editors";
import { wizardOptions } from "@/extensions/import/options";
import { IMPORT_TABLES, mayCreate } from "@/extensions/import/server";
import { ORG_ID, one, prefsData, rows } from "@/extensions/settings/data";
import { canEditSettings } from "@/extensions/settings/nav";
import { loadState, portfolioStats } from "@/extensions/onboarding/server";
import { canOnboard, ONBOARD_ROLES } from "@/extensions/onboarding/state";
import { suggestAutonomy, suggestPolicies } from "@/extensions/onboarding/suggest";
import { Onboarding, type OnboardingData } from "@/extensions/onboarding/ui/Onboarding";
import { ReadOnly } from "@/extensions/onboarding/ui/ReadOnly";

export const metadata: Metadata = { title: "Set up your portfolio · Propniti" };

const roleTitle = (r: string) => PERSONAS.find((p) => p.role === r)?.title ?? r.replace(/_/g, " ");

export default async function OnboardingPage() {
  const session = await currentSession();
  const header = <PageHeader icon={<Rocket />} title="Set up your portfolio" description="Five steps: your company, your data, approval rules, your team and a data check. AI suggests; you decide each one. Every step can be skipped and picked up later." />;
  if (!canOnboard(session.actor.role)) {
    return <>{header}<PageBody><ReadOnly who={ONBOARD_ROLES.map(roleTitle)} title={session.persona.title} /></PageBody></>;
  }
  const ctx = { db: getPlatform().db, ws: session.ws, actor: session.actor };
  const state = await loadState(ctx);
  const [options, stats, org, prefs, policies, agentRows, staff, regions, properties] = await Promise.all([
    wizardOptions(session),
    portfolioStats(ctx, state),
    one<{ name: string }>(ctx, "SELECT name FROM {orgs} WHERE id = ?", [ORG_ID]),
    prefsData(ctx, ORG_ID),
    rows<{ id: string; category: string; limit_cents: number | null; owner_approval_over_cents: number | null; approver_role: string; always_human: number }>(ctx, "SELECT id, category, limit_cents, owner_approval_over_cents, approver_role, always_human FROM {approval_policies} WHERE owner_entity_id IS NULL ORDER BY category"),
    rows<{ id: string; autonomy: string }>(ctx, "SELECT id, autonomy FROM {agent_definitions}"),
    rows<{ id: string; name: string; title: string; active: number; last_active_at: string | null; roles: string | null }>(ctx, "SELECT s.id, s.name, s.title, s.active, s.last_active_at, (SELECT group_concat(DISTINCT ra.role) FROM {role_assignments} ra WHERE ra.staff_id = s.id) AS roles FROM {staff} s ORDER BY s.active DESC, s.name LIMIT 60"),
    rows<{ id: string; name: string }>(ctx, "SELECT id, name FROM {regions} ORDER BY name"),
    rows<{ id: string; name: string; metro: string }>(ctx, "SELECT id, name, metro FROM {properties} ORDER BY (id LIKE '%-i%') DESC, metro, name LIMIT 300"),
  ]);
  const cents = (c: number | null) => (c == null ? null : c / 100);
  const policyNow = policies.map((p) => ({ id: p.id, category: p.category, limit: cents(p.limit_cents), owner: cents(p.owner_approval_over_cents), approver: p.approver_role, alwaysHuman: !!p.always_human }));
  const saved = new Map(agentRows.map((a) => [a.id, a.autonomy]));
  const defs = new Map(allAgents().map((a) => [a.key, a]));
  const agents = AGENT_ORDER.filter((k) => defs.has(k)).map((k) => ({ key: k, name: agentName(k), autonomy: saved.get(k) ?? defs.get(k)!.autonomy }));
  const profile = (prefs.profile ?? {}) as { legal_name?: string };

  const data: OnboardingData = {
    state,
    defaultName: profile.legal_name ?? org?.name ?? "",
    options,
    canImportProperties: mayCreate(session.actor.role, "properties"),
    canEditPolicies: canEditPolicies(session.actor.role),
    canInvite: canEditSettings(session.actor.role),
    stats: { units: stats.units, unitsFrom: stats.unitsFrom, workOrders: stats.workOrders.length, bills: stats.bills.length, rents: stats.rents.length },
    policies: suggestPolicies(stats, policyNow),
    fixedPolicies: policyNow.filter((p) => p.alwaysHuman || p.category === "Owner distribution").map((p) => p.category),
    autonomy: suggestAutonomy(stats.units, stats.unitsFrom, agents),
    team: staff.map((s) => ({ id: s.id, name: s.name, title: s.title, status: s.active ? "Active" : s.last_active_at ? "Inactive" : "Invited", roles: (s.roles ?? "").split(",").filter(Boolean).map(roleTitle) })),
    roles: INTERNAL_ROLES.filter((r) => r !== "platform_admin").map((r) => ({ value: r, label: roleTitle(r) })),
    regions: regions.map((r) => ({ value: r.id, label: r.name })),
    properties: properties.map((p) => ({ value: p.id, label: `${p.name} · ${p.metro}`, imported: /-i[0-9a-f]{10}-/.test(p.id) })),
    routes: Object.fromEntries(IMPORT_TABLES.flatMap((t) => { const r = getEntity(t)?.route; return r ? [[t, r]] : []; })),
  };
  return (
    <>
      {header}
      <PageBody>
        <Onboarding data={data} />
      </PageBody>
    </>
  );
}
