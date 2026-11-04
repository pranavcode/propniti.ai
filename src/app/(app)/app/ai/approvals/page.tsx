import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page";
import { ApprovalsInbox } from "@/ai/ui/ApprovalsInbox";
import { pageData } from "@/ai/ui/server";
import { proposalsPage, type Queue } from "@/ai/views";

export const metadata = { title: "Approvals · Propniti" };

const QUEUES: Queue[] = ["needs_you", "auto_handled", "waiting", "decided"];

// The approvals inbox: everything agents proposed, split by who acts next.
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const queue = (QUEUES.includes(sp.tab as Queue) ? sp.tab : "needs_you") as Queue;
  const { data } = await pageData();
  const initial = await proposalsPage(data, { queue, agent: sp.agent, risk: sp["f.risk"] ?? sp.risk, page: Number(sp.page) || 1 });
  return (
    <main>
      <PageHeader icon={<ShieldCheck />} title="Approvals" description="Agents propose, people approve. Each item shows why, the records it used, its confidence and the run that produced it. Anything that moves money or carries legal risk waits for you." />
      <div className="mt-4">
        <ApprovalsInbox initial={JSON.parse(JSON.stringify(initial))} initialQueue={queue} />
      </div>
    </main>
  );
}
