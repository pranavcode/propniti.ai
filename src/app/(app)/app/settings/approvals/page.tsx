import Link from "@/components/Link";
import { ShieldCheck } from "lucide-react";
import { INTERNAL_ROLES } from "@/entities";
import { PERSONAS } from "@/auth/personas";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { Money, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { list } from "@/server/query";
import { ChangeHistory } from "@/extensions/settings/History";
import { NoAccess, settingsSession } from "@/extensions/settings/pages";
import { rows } from "@/extensions/settings/data";
import { canEditSettings, canSettings } from "@/extensions/settings/nav";
import { EditPolicy, type PolicyRow } from "@/extensions/settings/ui/forms";

export const metadata = { title: "Approval policies · Propniti" };

const ORDER = ["Maintenance spend", "Bill payment", "Concession", "Write-off", "Owner distribution", "Legal", "Safety"];
const roleLabel = (r: string) => PERSONAS.find((p) => p.role === r)?.title ?? r.replace(/_/g, " ");
const ROLES = INTERNAL_ROLES.filter((r) => r !== "platform_admin").map((r) => ({ value: r, label: roleLabel(r) }));
const LABELS = { limit_cents: "auto-approve up to", owner_approval_over_cents: "owner approves above", approver_role: "approver", always_human: "always a person" };

type P = PolicyRow & { owner_entity_id: string | null; owner_entity_id__label?: string | null; applies_to: string };

function Rule({ p, canEdit }: { p: P; canEdit: boolean }) {
  return (
    <tr className="border-t">
      <th scope="row" className="px-3 py-2 text-left font-medium">
        <Link href={`/app/settings/approvals/${encodeURIComponent(p.id)}`} className="hover:text-primary hover:underline">{p.category}</Link>
      </th>
      <td className="px-3 py-2 text-right">{p.always_human ? <StatusBadge value="Always a person" tone="warning" /> : p.limit == null ? <span className="text-muted-foreground">Always a person</span> : <Money value={p.limit} style="whole" />}</td>
      <td className="px-3 py-2">{roleLabel(p.approver_role)}</td>
      <td className="px-3 py-2 text-right">{p.owner_approval_over == null ? <span className="text-muted-foreground">Never</span> : <Money value={p.owner_approval_over} style="whole" />}</td>
      <td className="w-10 px-2 py-1 text-right">{canEdit && <EditPolicy p={p} roles={ROLES} />}</td>
    </tr>
  );
}

function Table({ items, canEdit }: { items: P[]; canEdit: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full min-w-[640px] table-fixed text-[13px]">
        <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
          <tr><th className="w-[28%] px-3 py-2 font-medium">Decision</th><th className="w-[20%] px-3 py-2 text-right font-medium">Acts alone up to</th><th className="w-[28%] px-3 py-2 font-medium">Approver above that</th><th className="px-3 py-2 text-right font-medium">Owner approves above</th><th className="w-12" /></tr>
        </thead>
        <tbody>{items.sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category)).map((p) => <Rule key={p.id} p={p} canEdit={canEdit} />)}</tbody>
      </table>
    </div>
  );
}

export default async function ApprovalsPage() {
  const { session, ctx } = await settingsSession();
  if (!canSettings(session.actor.role)) return <NoAccess />;
  const canEdit = canEditSettings(session.actor.role);
  const [res, agents] = await Promise.all([
    list(ctx, "approval_policies", { size: 100, sort: ["category", "asc"] }),
    rows<{ id: string; name: string; autonomy: string; category: string | null }>(ctx, "SELECT a.id, a.name, a.autonomy, p.category FROM {agent_definitions} a LEFT JOIN {approval_policies} p ON p.id = a.approval_policy_id ORDER BY a.name"),
  ]);
  const all = res.rows as unknown as P[];
  const defaults = all.filter((p) => !p.owner_entity_id);
  const overrides = new Map<string, P[]>();
  for (const p of all.filter((x) => x.owner_entity_id)) overrides.set(p.applies_to, [...(overrides.get(p.applies_to) ?? []), p]);
  return (
    <>
      <PageHeader icon={<ShieldCheck />} title="Approval policies" description="How much agents and staff may approve alone, who approves above that, and when the owner signs off. Agents read these before they act: anything over a limit becomes a proposal for a person." />
      <PageBody>
        {!all.length ? (
          <EmptyState kind="table" title="No approval policies yet" description="Until policies exist, every agent action that moves money, changes a lease or involves legal or safety waits for a person." />
        ) : (
          <>
            <Section title="Org defaults" description="Apply to every owner entity without an override.">
              <Table items={defaults} canEdit={canEdit} />
            </Section>
            {[...overrides.entries()].map(([owner, items]) => (
              <Section key={owner} title={owner} description="Owner agreement override. Categories not listed use the org default.">
                <Table items={items} canEdit={canEdit} />
              </Section>
            ))}
          </>
        )}
        {agents.length > 0 && (
          <Section title="Agents bound by these policies" description="Autonomy is set per agent on the Agents page; the policy caps what any autonomy level may do alone.">
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {agents.map((a) => (
                <li key={a.id} className="rounded-lg border bg-card px-3 py-2">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-[12px] text-muted-foreground">{a.autonomy.replace(/_/g, " ")}{a.category ? ` · ${a.category}` : ""}</div>
                </li>
              ))}
            </ul>
            <Link href="/app/agents" className="mt-2 inline-block text-[12.5px] text-primary hover:underline">Change agent autonomy</Link>
          </Section>
        )}
        <Section title="Change history" description="Every edit, who made it and the values before and after.">
          <ChangeHistory ctx={ctx} entityTypes={["approval_policies"]} labels={LABELS} empty="Edits to limits, approvers and owner thresholds appear here." />
        </Section>
      </PageBody>
    </>
  );
}
