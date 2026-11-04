import Link from "next/link";
import { can } from "@/entities";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { SAMPLE_PHOTOS } from "@/extensions/maintenance/actions";
import { techJobs, technicians } from "@/extensions/maintenance/queries";
import { PHOTO_TAGS, photoTag } from "@/extensions/maintenance/rules";
import { parse } from "@/extensions/maintenance/store";
import { TechJobCard, type TechJob } from "@/extensions/maintenance/ui/TechJobs";

export const metadata = { title: "Technician jobs · Propniti" };

type Props = { searchParams: Promise<{ tech?: string }> };

// The technician's phone view. Technicians aren't a sign-in role in the demo, so the supervisor
// opens it for any technician with open in-house jobs in their scope.
export default async function MyJobs({ searchParams }: Props) {
  const sp = await searchParams;
  const { actor, ws } = await currentSession();
  if (!can(actor.role, "work_orders.set_status", "work_orders")) {
    return <main className="p-6"><EmptyState title="The technician view is for maintenance staff" description="Switch to the maintenance supervisor from your avatar menu." action={{ label: "Go to your home", href: "/app" }} /></main>;
  }
  const db = getPlatform().db;
  const techs = await technicians(db, ws, actor);
  const tech = techs.find((t) => t.id === sp.tech) ?? techs[0];
  const rows = tech ? await techJobs(db, ws, actor, tech.id) : [];
  const jobs: TechJob[] = rows.map((r) => ({
    id: String(r.id), title: String(r.title), description: String(r.description ?? ""), status: String(r.status), priority: String(r.priority), category: String(r.category),
    sla_due_at: (r.sla_due_at as string) ?? null, permission_to_enter: !!r.permission_to_enter, property: String(r.property), street: (r.street as string) ?? null, unit: (r.unit as string) ?? null,
    past_sla: !!r.past_sla, minutes: Number(r.minutes ?? 0), photos: parse<TechJob["photos"]>(r.photos, []).filter((p) => p.url),
  }));
  const photos = SAMPLE_PHOTOS.map((url) => ({ url, label: PHOTO_TAGS[photoTag(url)!].label }));
  const active = jobs.filter((j) => j.status === "In progress").length;
  return (
    <main>
      <PageHeader title={tech ? `${tech.name.split(" ")[0]}'s jobs` : "Technician jobs"}
        meta={tech ? <><span className="tabular-nums">{jobs.length} open</span><span>·</span><span>{active} in progress</span><span>·</span><span>{jobs.filter((j) => j.past_sla).length} past SLA</span></> : undefined}>
        {techs.length > 0 && (
          <nav aria-label="Technician" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
            {techs.map((t) => (
              <Link key={t.id} href={`/app/maintenance/my-jobs?tech=${encodeURIComponent(t.id)}`} aria-current={t.id === tech?.id ? "page" : undefined}
                className={cn("shrink-0 rounded-full border px-3 py-1 text-[12.5px] whitespace-nowrap", t.id === tech?.id ? "border-primary bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {t.name} <span className="tabular-nums opacity-70">{t.open}</span>
              </Link>
            ))}
          </nav>
        )}
      </PageHeader>
      <PageBody>
        <div data-tour="mx-tech" className="mx-auto w-full max-w-xl flex flex-col gap-3">
          {jobs.length ? jobs.map((j) => <TechJobCard key={j.id} job={j} photos={photos} />)
            : <EmptyState title={tech ? "No open jobs" : "No technicians with open jobs"} description={tech ? "New in-house jobs show here as soon as they're dispatched." : "Dispatch a request to an in-house technician from the triage page."} action={{ label: "Back to maintenance", href: "/app/maintenance" }} />}
        </div>
      </PageBody>
    </main>
  );
}
