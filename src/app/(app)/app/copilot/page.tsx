import Link from "@/components/Link";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app/page";
import { RelativeDate } from "@/components/app/display";
import { cn } from "@/lib/utils";
import { threadMessages, threads } from "@/ai/assistant";
import { AssistantChat } from "@/ai/ui/AssistantChat";
import { pageData } from "@/ai/ui/server";
import { modelInfo } from "@/ai/providers";

export const metadata = { title: "Copilot · Propniti" };

type Saved = { role: string; content: string; plan: { run_id?: string; mode?: string; trace?: unknown[] } | null; citations: unknown[]; model: string | null };

// Full-page assistant with saved conversations. Same backend as the ⌘J dock.
export default async function CopilotPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { data, persona } = await pageData();
  const list = data.ws === "base" ? [] : await threads(data, persona.id, 30);
  const open = sp.thread && data.ws !== "base" ? await threadMessages(data, persona.id, sp.thread) : null;
  const turns = ((open?.messages ?? []) as unknown as Saved[]).map((m) =>
    m.role === "user"
      ? { role: "user" as const, text: m.content }
      : { role: "assistant" as const, reply: { threadId: sp.thread!, messageId: "", runId: m.plan?.run_id ?? "", mode: (m.plan?.mode ?? "chat") as "chat", answer: m.content, source: m.model === "rules" || !m.model ? "Rules (no model)" : m.model, model: m.model ?? "rules", live: false, citations: m.citations as never[], trace: (m.plan?.trace ?? []) as never[], proposals: [] } },
  );
  const m = modelInfo();
  return (
    <main className="flex h-full flex-col">
      <PageHeader icon={<Sparkles />} title="Copilot" description="Ask about your portfolio, tell Propniti what to do, or ask how something works. Answers show what was looked up; actions wait for your confirmation." meta={<span>Model: {m.label}</span>} />
      <div className="mt-4 grid min-h-0 flex-1 gap-4 px-4 pb-6 md:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden rounded-lg border bg-card lg:block">
          <div className="flex items-center justify-between border-b px-3 py-2 text-[13px] font-semibold">Conversations <Link href="/app/copilot" className="text-[12px] font-normal text-primary hover:underline">New</Link></div>
          {list.length ? (
            <ul className="max-h-[70vh] overflow-y-auto py-1">
              {list.map((t) => (
                <li key={String(t.id)}>
                  <Link href={`/app/copilot?thread=${t.id}`} className={cn("block px-3 py-1.5 hover:bg-muted/50", sp.thread === t.id && "bg-muted")}>
                    <span className="block truncate text-[12.5px]">{String(t.title)}</span>
                    <span className="text-[11px] text-muted-foreground"><RelativeDate value={String(t.updated_at)} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="p-3 text-[12px] text-muted-foreground">Your conversations are saved here.</p>}
        </aside>
        <section className="min-h-[60vh] overflow-hidden rounded-lg border bg-card">
          <AssistantChat key={sp.thread ?? "new"} page threadId={open ? sp.thread : undefined} initialTurns={turns} suggestions={persona.assistantPrompts} />
        </section>
      </div>
    </main>
  );
}
