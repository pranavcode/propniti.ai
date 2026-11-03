import Link from "next/link";
import { List } from "lucide-react";
import { can } from "@/entities";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { leasingCtx, pipeline, scopedProperties } from "@/extensions/leasing/data";
import { PipelineBoard } from "@/extensions/leasing/ui/PipelineBoard";
import { cn } from "@/lib/utils";

export const metadata = { title: "Pipeline board · Propniti" };

type Props = { searchParams: Promise<{ property?: string }> };

export default async function PipelinePage({ searchParams }: Props) {
  const { property } = await searchParams;
  const c = await leasingCtx();
  if (!can(c.actor.role, "read", "prospects")) {
    return <PageBody><EmptyState title="Leasing isn't part of your role" description="Switch role from your avatar menu to see the board as a leasing agent or broker." action={{ label: "Go to your home", href: "/app" }} /></PageBody>;
  }
  const props = await scopedProperties(c);
  const pick = props.some((p) => p.id === property) ? property : undefined;
  const cards = await pipeline(c, pick);
  const stale = cards.filter((x) => x.stale).length;
  const chip = (href: string, label: string, on: boolean) => (
    <Link key={href} href={href} aria-current={on ? "true" : undefined} className={cn("rounded-full border px-2.5 py-1 text-[12px] whitespace-nowrap transition-colors", on ? "border-primary bg-primary/10 font-medium text-primary" : "bg-card text-muted-foreground hover:text-foreground")}>{label}</Link>
  );
  return (
    <>
      <PageHeader
        title="Pipeline board"
        description="Every open lead from first inquiry to a signed lease. Drag a card one column to move it; approval stays with the broker."
        meta={<><span>{cards.length} on the board</span>{stale > 0 && <Link href="/app/leasing/prospects?view=follow-up" className="text-tone-warning hover:underline">{stale} with no contact in 3+ days</Link>}<span>{c.actor.scope.label}</span></>}
        actions={<Button asChild size="sm" variant="outline"><Link href="/app/leasing/prospects?view=open"><List />List view</Link></Button>}
      >
        {props.length > 1 && <div className="flex gap-1.5 overflow-x-auto pb-1">{[chip("/app/leasing/pipeline", "All properties", !pick), ...props.map((p) => chip(`/app/leasing/pipeline?property=${p.id}`, p.name, pick === p.id))]}</div>}
      </PageHeader>
      <PageBody>
        {cards.length ? <PipelineBoard key={cards.map((x) => x.id + x.column).join()} cards={cards} role={c.actor.role} /> : <EmptyState title="No open leads" description="New inquiries from listing sites, the website and walk-ins land in the Lead column." action={{ label: "Add prospect", href: "/app/leasing/prospects?new=1" }} />}
      </PageBody>
    </>
  );
}
