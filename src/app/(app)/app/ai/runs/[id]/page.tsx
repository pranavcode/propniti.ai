import { notFound } from "next/navigation";
import { Activity } from "lucide-react";
import { PageHeader } from "@/components/app/page";
import { AGENT_LABEL } from "@/ai/ui/labels";
import { RunView } from "@/ai/ui/RunView";
import { pageData } from "@/ai/ui/server";
import { runDetail } from "@/ai/views";

export const metadata = { title: "Agent run · Propniti" };

const TRIGGER: Record<string, string> = { schedule: "Scheduled run", event: "Started by an event", manual: "Started with Run now", chat: "Started from the assistant" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await pageData();
  const r = await runDetail(data, id);
  if (!r) notFound();
  const run = r.run as Record<string, unknown>;
  const trigger = TRIGGER[String(run.trigger_kind)] ?? "Run";
  return (
    <main>
      <PageHeader icon={<Activity />} title={`${AGENT_LABEL[String(run.agent_key)] ?? run.agent_key} run`} description="Every step the agent took: what it looked up, what the model said, and what it proposed." meta={<><span>{trigger}</span><span>Run {String(run.id)}</span></>} />
      <div className="mt-5">
        <RunView runId={id} initial={JSON.parse(JSON.stringify(r))} />
      </div>
    </main>
  );
}
