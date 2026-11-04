import Link from "next/link";
import { ArrowLeft, KeyRound, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { Money, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { portalCtx } from "@/extensions/owners/portal/context";
import { JOB_TABS, job, jobCounts, jobs, type JobTab } from "@/extensions/owners/portal/vendor-data";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { JobActions } from "@/extensions/owners/portal/ui/vendor/JobActions";
import { JobRow } from "@/extensions/owners/portal/ui/vendor/JobRow";
import { Pager } from "@/extensions/owners/portal/ui/vendor/Pager";

type Props = { searchParams: Promise<{ tab?: string; page?: string; id?: string }> };

const EVENT: Record<string, string> = { Status: "Status changed", Assigned: "Assigned", Note: "Note", Submission: "Invoice sent", Validation: "Invoice checked", Approval: "Approved" };

export default async function VendorJobs({ searchParams }: Props) {
  const c = await portalCtx("vendor");
  if (!c) return null;
  const sp = await searchParams;
  if (sp.id) {
    const j = await job(c, sp.id);
    if (!j) return <EmptyState title="Job not found" description="It may have been reassigned. Check your job list." action={{ label: "Back to jobs", href: "/portal/vendor/jobs" }} />;
    return (
      <>
        <Link href="/portal/vendor/jobs" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />All jobs</Link>
        <PortalTitle eyebrow={`${j.id} · ${j.category}`} title={j.title} actions={<JobActions me={c.me} id={j.id} title={j.title} status={j.status} invoiced={!!j.invoiced || !!j.owner_declined} />} />
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <section className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap gap-2"><StatusBadge value={j.status} /><StatusBadge value={j.priority} tone={j.priority === "Emergency" ? "danger" : j.priority === "Urgent" ? "warning" : "neutral"} /></div>
              {j.description && <p className="mt-3 text-[13.5px] whitespace-pre-wrap text-pretty">{j.description}</p>}
              {j.photos.length > 0 && (
                <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {j.photos.map((p, i) => (
                    <li key={i} className="overflow-hidden rounded-lg border">
                      {/* eslint-disable-next-line @next/next/no-img-element -- static webp or a resident's upload */}
                      <img src={p.url.startsWith("/") && !p.url.includes("-400.") ? p.url.replace(/\.webp$/, "-400.webp") : p.url} alt={p.caption || `Photo ${i + 1}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                      <p className="px-2 py-1 text-[11.5px] text-muted-foreground">{p.stage ?? "Photo"}{p.caption ? ` · ${p.caption}` : ""}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="tl-h" className="rounded-xl border bg-card p-4">
              <h2 id="tl-h" className="text-[14px] font-semibold">Timeline</h2>
              <ol className="mt-3 space-y-3 border-l pl-4">
                <li className="relative text-[13px]"><span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-muted-foreground/50" />Opened <span className="text-muted-foreground">· {formatDateTime(j.opened_at)}</span></li>
                {j.events.map((e) => (
                  <li key={e.id} className="relative text-[13px]"><span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-primary" />{EVENT[e.kind] ?? e.kind}{e.status ? `: ${e.status}` : ""} <span className="text-muted-foreground">· {formatDateTime(e.at)} · {e.actor_kind === "vendor" ? "you" : e.actor_kind}</span></li>
                ))}
              </ol>
            </section>
          </div>
          <aside className="space-y-3">
            <section className="rounded-xl border bg-card p-4 text-[13px]">
              <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 text-muted-foreground" /><span><span className="font-medium">{j.property}</span>{j.unit ? `, unit ${j.unit}` : ", common area"}<br /><span className="text-muted-foreground">{j.street}, {j.city}</span></span></p>
              <p className="mt-2 flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" />{j.permission_to_enter ? "Resident gave permission to enter" : "Call the resident before entering"}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
                <div><dt className="text-[11.5px] text-muted-foreground">Scheduled</dt><dd>{j.scheduled_at ? formatDateTime(j.scheduled_at) : "—"}</dd></div>
                <div><dt className="text-[11.5px] text-muted-foreground">Due by</dt><dd>{j.sla_due_at ? formatDateTime(j.sla_due_at) : "—"}</dd></div>
                <div><dt className="text-[11.5px] text-muted-foreground">Estimate</dt><dd><Money value={j.estimate_cents} cents /></dd></div>
                <div><dt className="text-[11.5px] text-muted-foreground">Invoiced</dt><dd><Money value={j.invoiced ? j.cost_cents : null} cents /></dd></div>
              </dl>
            </section>
          </aside>
        </div>
      </>
    );
  }
  const tab = (sp.tab && sp.tab in JOB_TABS ? sp.tab : "new") as JobTab;
  const page = Math.max(1, Number(sp.page) || 1);
  const [counts, list] = await Promise.all([jobCounts(c), jobs(c, tab, page)]);
  return (
    <>
      <PortalTitle title="Jobs" description="Accept new assignments, see what's scheduled and invoice finished work." />
      <nav aria-label="Job status" className="mb-3 flex gap-1 overflow-x-auto">
        {(Object.keys(JOB_TABS) as JobTab[]).map((t) => (
          <Link key={t} aria-current={t === tab ? "page" : undefined} href={`/portal/vendor/jobs?tab=${t}`} className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[13px] max-md:h-11", t === tab ? "border-primary/40 bg-primary/[0.07] font-medium text-primary" : "bg-card hover:bg-muted")}>
            {JOB_TABS[t].label}<span className="text-[11.5px] text-muted-foreground tabular-nums">{counts[t]}</span>
          </Link>
        ))}
      </nav>
      <section className="overflow-hidden rounded-xl border bg-card">
        {list.rows.length ? <ul className="divide-y">{list.rows.map((j) => <JobRow key={j.id} j={j} me={c.me} />)}</ul>
          : <div className="p-4"><EmptyState kind="tasks" title={tab === "new" ? "No new assignments" : tab === "invoice" ? "Nothing left to invoice" : "No jobs here"} description={tab === "new" ? "New assignments from the maintenance team show up here." : "Jobs move here as their status changes."} compact /></div>}
        <Pager base="/portal/vendor/jobs" params={{ tab }} page={page} size={list.size} total={list.total} />
      </section>
    </>
  );
}
