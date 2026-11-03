import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CreditCard, FileSignature, ShieldAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money, StatusBadge } from "@/components/app/display";
import { portalCtx } from "@/extensions/owners/portal/context";
import { currentLease, daysUntil, insurance, me, nextRentDue, offers, OPEN_WO, openCharges, parsePhotos, requests } from "@/extensions/owners/portal/resident-data";
import { AskCard } from "@/extensions/owners/portal/ui/resident/AskCard";
import { Card, fmtDay, fmtWhen, RequestTimeline } from "@/extensions/owners/portal/ui/resident/bits";

const greeting = () => {
  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Chicago" }));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export default async function ResidentHome() {
  const c = await portalCtx("resident");
  if (!c) return null;
  const r = await me(c);
  if (!r) return null;
  const lease = await currentLease(c, r.household_id);
  const [charges, reqs, offerList, policy] = await Promise.all([
    openCharges(c, r.household_id),
    requests(c, lease?.unit_id ?? null),
    lease ? offers(c, lease.id) : [],
    lease ? insurance(c, lease.id) : null,
  ]);
  const due = charges.reduce((a, x) => a + x.balance_cents, 0);
  const overdue = charges.some((x) => x.status === "Overdue");
  const processing = charges.length > 0 && charges.every((x) => x.status === "Processing");
  const open = reqs.filter((w) => OPEN_WO.includes(w.status));
  const sent = offerList.filter((o) => o.status === "Sent");
  const hero = parsePhotos(lease?.photos)[0]?.replace(/-400\.webp$/, ".webp") ?? (lease ? `/img/props/${lease.property_id}.webp` : null);
  const insWarn = policy && (policy.status === "Lapsed" || policy.status === "Expiring" || daysUntil(policy.expires_on) <= 30);

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-2xl border bg-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- static webp in /public; the Workers build has no image optimizer */}
        {hero && <img src={hero} alt={lease ? `${lease.property}` : ""} className="h-40 w-full object-cover md:h-56" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4 text-white md:p-6">
          <p className="text-[12.5px] font-medium text-white/85">{lease ? `${lease.property} · Apartment ${lease.unit}` : "Your home"}</p>
          <h1 className="text-[22px] font-semibold tracking-tight md:text-[26px]">{greeting()}, {r.first_name}</h1>
        </div>
      </section>

      {sent.length > 0 && lease && (
        <Link href="/portal/resident/lease#renewal" className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.06] p-4 transition-colors hover:bg-primary/[0.09] focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
          <FileSignature className="size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold">Your renewal offer is ready</p>
            <p className="text-[12.5px] text-muted-foreground">{sent.map((o) => `${o.term_months} months at $${(o.rent_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`).join(" or ")}{sent[0].expires_on ? ` · respond by ${fmtDay(sent[0].expires_on)}` : ""}</p>
          </div>
          <ArrowRight className="size-4 text-primary" aria-hidden />
        </Link>
      )}

      {insWarn && policy && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-tone-warning/40 bg-tone-warning/10 p-4">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-tone-warning" aria-hidden />
          <div className="min-w-0 flex-1 text-[13px]">
            <p className="font-semibold">{policy.status === "Lapsed" || daysUntil(policy.expires_on) < 0 ? "Your renters insurance has lapsed" : `Your renters insurance expires ${fmtDay(policy.expires_on)}`}</p>
            <p className="text-muted-foreground">Your lease requires active coverage. Send us the renewal declarations page when you have it.</p>
          </div>
          <Button asChild size="sm" variant="outline"><Link href="/portal/resident/lease#insurance">Details</Link></Button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Balance" action={<StatusBadge value={!charges.length ? "Paid up" : processing ? "Processing" : overdue ? "Past due" : "Due"} tone={!charges.length ? "success" : processing ? "info" : overdue ? "danger" : "warning"} />}>
          <p className="text-[32px] leading-none font-semibold tracking-tight"><Money value={due} cents tone="none" /></p>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {!charges.length ? `Nothing due. Next rent ${lease ? `of $${(lease.rent_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} ` : ""}is due ${fmtDay(nextRentDue())}.`
              : processing ? "Your payment is processing and usually clears in 1–2 business days."
              : `${charges.length} open charge${charges.length === 1 ? "" : "s"}, oldest due ${fmtDay(charges[0].due_on)}.`}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {charges.length > 0 && !processing && <Button asChild><Link href="/portal/resident/pay"><CreditCard />Pay now</Link></Button>}
            <Button asChild variant="outline"><Link href="/portal/resident/pay#ledger">View ledger</Link></Button>
          </div>
          <p className="mt-3 border-t pt-3 text-[12.5px] text-muted-foreground">Autopay is <span className="font-medium text-foreground">{r.autopay ? "on" : "off"}</span>. <Link href="/portal/resident/pay#autopay" className="text-primary hover:underline">{r.autopay ? "Manage" : "Turn it on"}</Link></p>
        </Card>

        <Card title="Maintenance" action={<Button asChild size="sm" variant="outline"><Link href="/portal/resident/requests?new=1"><Wrench />New request</Link></Button>}>
          {open.length ? (
            <ul className="space-y-4">
              {open.slice(0, 3).map((w) => (
                <li key={w.id}>
                  <Link href={`/portal/resident/requests?wo=${w.id}`} className="group block rounded-md focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-[13.5px] font-medium group-hover:text-primary">{w.title}</p>
                      {(w.priority === "Emergency" || w.priority === "Urgent") && <StatusBadge value={w.priority} tone={w.priority === "Emergency" ? "danger" : "warning"} />}
                    </div>
                    {w.scheduled_at && <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground"><CalendarClock className="size-3.5" />Visit {fmtWhen(w.scheduled_at)}{w.vendor ? ` · ${w.vendor}` : ""}</p>}
                    <RequestTimeline className="mt-2" status={w.status} openedAt={w.opened_at} scheduledAt={w.scheduled_at} completedAt={w.completed_at} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-6 text-center">
              <p className="text-[13px] font-medium">No open requests</p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">{reqs[0] ? `Your last one, “${reqs[0].title}”, is ${reqs[0].status.toLowerCase()}.` : "Something not working? Tell us and add a photo."}</p>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <AskCard prompts={c.persona.assistantPrompts} />
        <Card title="Your lease">
          {lease ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
              <div><dt className="text-[11.5px] text-muted-foreground">Monthly rent</dt><dd className="font-medium"><Money value={lease.rent_cents} cents tone="none" /></dd></div>
              <div><dt className="text-[11.5px] text-muted-foreground">Lease ends</dt><dd className="font-medium tabular-nums">{fmtDay(lease.end_on, true)}</dd></div>
              <div><dt className="text-[11.5px] text-muted-foreground">Apartment</dt><dd className="font-medium">#{lease.unit}{lease.beds != null ? ` · ${lease.beds} bed` : ""}</dd></div>
              <div><dt className="text-[11.5px] text-muted-foreground">Renters insurance</dt><dd className="font-medium">{policy ? <StatusBadge value={policy.status} tone={policy.status === "Active" ? "success" : policy.status === "Lapsed" ? "danger" : "warning"} /> : <span className="inline-flex items-center gap-1 text-tone-warning"><AlertTriangle className="size-3.5" />None on file</span>}</dd></div>
              <div className="col-span-2 pt-1"><Link href="/portal/resident/lease" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline">Lease, documents and renewal<ArrowRight className="size-3.5" /></Link></div>
            </dl>
          ) : <p className="text-[13px] text-muted-foreground">We couldn&apos;t find an active lease. Message the office if this looks wrong.</p>}
        </Card>
      </div>
    </div>
  );
}
