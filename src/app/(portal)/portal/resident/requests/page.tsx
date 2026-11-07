import { CalendarClock, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { AS_OF } from "@/seed/constants";
import { StatusBadge } from "@/components/app/display";
import { portalCtx } from "@/extensions/owners/portal/context";
import { currentLease, me, OPEN_WO, parsePhotos, requestFacts, requests } from "@/extensions/owners/portal/resident-data";
import { requestJourney } from "@/extensions/owners/portal/journeys";
import { JourneyBar } from "@/extensions/owners/portal/ui/Journey";
import { RateRequest } from "@/extensions/owners/portal/ui/resident/RateRequest";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { NewRequest } from "@/extensions/owners/portal/ui/resident/NewRequest";
import { fmtDay, fmtWhen } from "@/extensions/owners/portal/ui/resident/bits";

export default async function ResidentRequests({ searchParams }: { searchParams: Promise<{ new?: string; wo?: string }> }) {
  const c = await portalCtx("resident");
  if (!c) return null;
  const r = await me(c);
  if (!r) return null;
  const sp = await searchParams;
  const lease = await currentLease(c, r.household_id);
  const list = await requests(c, lease?.unit_id ?? null, lease?.move_in_on ?? lease?.start_on ?? null);
  const open = list.filter((w) => OPEN_WO.includes(w.status));
  const done = list.filter((w) => !OPEN_WO.includes(w.status));
  const formOpen = sp.new === "1";

  const item = (w: (typeof list)[number]) => {
    const photos = parsePhotos(w.photos);
    const hot = sp.wo === w.id;
    const j = requestJourney(requestFacts(w));
    // Ask for a rating on repairs finished in the last 30 days, not on years of history.
    const recent = !w.completed_at || Date.parse(w.completed_at) > Date.parse(AS_OF) - 30 * 86_400_000;
    return (
      <li key={w.id} id={w.id} className={cn("scroll-mt-20 rounded-xl border bg-card p-4 transition-shadow", hot && "border-primary/50 ring-2 ring-primary/20")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold">{w.title}</p>
            <p className="text-[12px] text-muted-foreground">{w.id} · {w.category} · opened {fmtDay(w.opened_at, true)}</p>
          </div>
          <div className="flex gap-1.5">
            {(w.priority === "Emergency" || w.priority === "Urgent") && <StatusBadge value={w.priority} tone={w.priority === "Emergency" ? "danger" : "warning"} />}
            <StatusBadge value={w.status} />
          </div>
        </div>
        {w.description && w.description !== w.title && <p className="mt-2 line-clamp-3 text-[13px] text-muted-foreground">{w.description}</p>}
        {w.scheduled_at && OPEN_WO.includes(w.status) && <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium"><CalendarClock className="size-4 text-primary" />Visit {fmtWhen(w.scheduled_at)}{w.vendor ? ` · ${w.vendor}` : ""}</p>}
        <JourneyBar className="mt-3" journey={j} label={`${w.id} progress`} />
        <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2.5">
          <p className="text-[13px] font-medium">{j.next.title}</p>
          <p className="text-[12.5px] text-muted-foreground">{j.next.body}</p>
          {j.next.you && recent && <div className="mt-2"><p className="mb-1 text-[12.5px] font-medium">How did it go?</p><RateRequest me={c.me} workOrderId={w.id} /></div>}
        </div>
        {photos.length > 0 && (
          <div className="mt-3 flex gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- photos are small data URLs or static webp */}
            {photos.slice(0, 4).map((p, i) => <img key={i} src={p.startsWith("/img/") ? p.replace(/\.webp$/, "-400.webp") : p} alt={`Photo ${i + 1} for ${w.title}`} className="size-16 rounded-lg object-cover ring-1 ring-border" loading="lazy" />)}
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      <PortalTitle title="Maintenance" description="Report a problem, add photos and follow it until it's fixed." actions={formOpen ? undefined : <NewRequest me={c.me} open={false} />} />
      <div className="space-y-6">
        {formOpen && <NewRequest me={c.me} open />}
        <p className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-[12.5px] text-muted-foreground"><Phone className="size-4 shrink-0" />Emergency after hours (flooding, no heat, gas smell)? Call the office line; if you smell gas, leave and call 911.</p>
        <section aria-labelledby="open-req">
          <h2 id="open-req" className="mb-2 text-[15px] font-semibold tracking-tight">Open <span className="font-normal text-muted-foreground tabular-nums">({open.length})</span></h2>
          {open.length ? <ul className="space-y-3">{open.map(item)}</ul> : <p className="rounded-xl border border-dashed bg-card px-4 py-8 text-center text-[13px] text-muted-foreground">No open requests. If something breaks, tell us here and add a photo.</p>}
        </section>
        {done.length > 0 && (
          <section aria-labelledby="past-req">
            <h2 id="past-req" className="mb-2 text-[15px] font-semibold tracking-tight">Past requests</h2>
            <ul className="space-y-3">{done.slice(0, 20).map(item)}</ul>
          </section>
        )}
      </div>
    </>
  );
}
