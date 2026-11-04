import Link from "@/components/Link";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app/page";
import { RelativeDate } from "@/components/app/display";
import { cn } from "@/lib/utils";
import { threadMessages, threads } from "@/ai/assistant";
import { AssistantChat, SampleTag } from "@/ai/ui/AssistantChat";
import { pageData } from "@/ai/ui/server";
import { modelInfo } from "@/ai/providers";

export const metadata = { title: "Copilot · Propniti" };

// Full-page assistant with saved conversations. Same backend as the ⌘J dock.
export default async function CopilotPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { data, persona } = await pageData();
  const list = await threads(data, persona.id, 30);
  const open = sp.thread ? await threadMessages(data, persona.id, sp.thread, 100) : null;
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
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><RelativeDate value={String(t.updated_at)} />{t.sample && <SampleTag />}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="p-3 text-[12px] text-muted-foreground">Your conversations are saved here.</p>}
        </aside>
        <section className="min-h-[60vh] overflow-hidden rounded-lg border bg-card">
          {open?.thread.sample && <p className="border-b bg-muted/40 px-4 py-2 text-[12px] text-muted-foreground"><SampleTag /> <span className="ml-1">A sample conversation from the demo data. The answers were computed from that data by the rules assistant; ask a follow-up to continue it.</span></p>}
          <AssistantChat key={sp.thread ?? "new"} page threadId={open ? sp.thread : undefined} initialTurns={open?.turns} suggestions={persona.assistantPrompts} />
        </section>
      </div>
    </main>
  );
}
