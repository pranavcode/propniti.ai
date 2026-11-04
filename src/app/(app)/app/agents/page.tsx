import { Bot } from "lucide-react";
import Link from "next/link";
import { PERMISSIONS } from "@/auth/personas";
import { PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { AgentsCenter } from "@/ai/ui/AgentsCenter";
import { pageData } from "@/ai/ui/server";
import { agentCards, aiStatus } from "@/ai/views";
import { canEditPolicies } from "@/ai/policy-editors";

export const metadata = { title: "Agents · Propniti" };

// Agents command center: what each agent does, how it's doing, its autonomy and schedule, and
// "Run now" with the live step trace.
export default async function AgentsPage() {
  const { data, persona } = await pageData();
  const [agents, status] = await Promise.all([agentCards(data), aiStatus(data)]);
  const access = PERMISSIONS[persona.role].intelligence ?? "none";
  const pending = agents.reduce((s, a) => s + a.pending, 0);
  return (
    <main>
      <PageHeader
        icon={<Bot />}
        title="Agents"
        description="Eight agents watch your portfolio. They look things up with the same tools you have, propose actions with their reasons, and apply only what your approval policies allow."
        meta={<><span>{agents.filter((a) => a.enabled).length} of {agents.length} on</span><span>{agents.reduce((s, a) => s + a.runs30, 0)} runs in 30 days</span><span>{pending} waiting for a person</span></>}
        actions={<><Button asChild variant="outline" size="sm"><Link href="/app/ai/activity">All runs</Link></Button><Button asChild size="sm"><Link href="/app/ai/approvals">Approvals{pending ? ` (${pending})` : ""}</Link></Button></>}
      />
      <div className="mt-5">
        <AgentsCenter agents={agents} status={status} canManage={canEditPolicies(persona.role)} canRun={access !== "none"} canEditPolicies={canEditPolicies(persona.role)} />
      </div>
    </main>
  );
}
