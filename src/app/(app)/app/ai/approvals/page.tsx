import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/page";
import { ApprovalsInbox } from "@/ai/ui/ApprovalsInbox";
import { pageData } from "@/ai/ui/server";
import { getEntity } from "@/entities";
import { proposalFocus, proposalsPage, type Queue } from "@/ai/views";
import { approvalFilters } from "@/ai/filters";

export const metadata = { title: "Approvals · Propniti" };

const QUEUES: Queue[] = ["needs_you", "auto_handled", "waiting", "decided"];

// The approvals inbox: everything agents proposed, split by who acts next.
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // A repeated parameter arrives as a list; keep only single values.
  const sp = Object.fromEntries(Object.entries(await searchParams).filter((e): e is [string, string] => typeof e[1] === "string"));
  const { data } = await pageData();
  const filters = approvalFilters(sp);
  // ?proposal=<id> or ?record=applications/<id> opens the queue and page holding that proposal.
  const focus = sp.proposal || sp.record ? await proposalFocus(data, { proposal: sp.proposal, record: sp.record }) : null;
  const queue = focus?.queue ?? ((QUEUES.includes(sp.tab as Queue) ? sp.tab : "needs_you") as Queue);
  const initial = await proposalsPage(data, focus ? { queue, page: focus.page, facets: true } : { queue, ...filters, page: Number(sp.page) || 1, facets: true });
  const [type, id] = sp.record?.split(/\/(.*)/) ?? [];
  const route = type && id ? getEntity(type)?.route : undefined;
  return (
    <main>
      <PageHeader icon={<ShieldCheck />} title="Approvals" description="Agents propose, people approve. Each item shows why, the records it used, its confidence and the run that produced it. Anything that moves money or carries legal risk waits for you." />
      <div className="mt-4">
        <ApprovalsInbox initial={JSON.parse(JSON.stringify(initial))} initialQueue={queue} initialFilters={focus ? {} : filters} focusId={focus?.id} missing={!focus && (sp.proposal || sp.record) ? { href: route && `${route}/${encodeURIComponent(id)}` } : undefined} />
      </div>
    </main>
  );
}
