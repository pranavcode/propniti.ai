import Link from "next/link";
import { ArrowRight, BedDouble, CalendarDays, CircleDollarSign, FileCheck2, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money, StatusBadge } from "@/components/app/display";
import { portalCtx } from "@/extensions/owners/portal/context";
import { NEXT, STEPS, application, applicantMe, applicationDocs, checklist, stepOf } from "@/extensions/owners/portal/applicant-data";
import { PortalAsk } from "@/extensions/owners/portal/ui/PortalAsk";
import { NoApplication } from "@/extensions/owners/portal/ui/applicant/NoApplication";
import { Timeline, type Step } from "@/extensions/owners/portal/ui/applicant/Timeline";

const day = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null);
const hero = (photos: string, id: string) => {
  try {
    return (JSON.parse(photos) as string[])[0] ?? `/img/props/${id}.webp`;
  } catch {
    return `/img/props/${id}.webp`;
  }
};
const TONE: Record<string, "info" | "success" | "warning" | "danger" | "neutral"> = { Started: "neutral", Submitted: "info", Screening: "info", Review: "info", Approved: "success", Conditional: "warning", Denied: "danger", Leased: "success", Withdrawn: "neutral" };

// Applicant home: the home they applied for, where the application is, what happens next and
// what's still needed. Screening results stay with the leasing team; the applicant sees progress only.
export default async function ApplicantHome() {
  const c = await portalCtx("applicant");
  if (!c) return null;
  const [me, app] = await Promise.all([applicantMe(c), application(c)]);
  if (!app) return <NoApplication />;
  const docs = await applicationDocs(c, app.id);
  const list = checklist(docs);
  const missing = list.filter((x) => !x.doc);
  const at = stepOf(app.stage);
  const denied = app.stage === "Denied";
  const dates = [null, day(app.submitted_at), day(app.screening_done), null, day(app.decided_at), null];
  const steps: Step[] = STEPS.map((label, i) => ({
    label: i === 4 && at >= 4 ? (app.stage === "Leased" ? "Approved" : app.stage) : label,
    date: dates[i],
    state: i === 4 && denied ? "denied" : i < at || (i === at && app.stage === "Leased") ? "done" : i === at ? "current" : "todo",
  }));

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border bg-card">
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- static webp in /public; the Workers build has no image optimizer */}
          <img src={hero(app.photos, app.property_id)} alt={app.property} className="h-40 w-full object-cover md:h-56" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-4 text-white md:p-6">
            <p className="text-[12.5px] font-medium text-white/85">{app.property} · Unit {app.unit}</p>
            <h1 className="text-[22px] font-semibold tracking-tight md:text-[26px]">Hi {me?.first_name ?? c.persona.name.split(" ")[0]}, here&apos;s your application</h1>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {[
            [BedDouble, "Home", app.beds != null ? `${app.beds === 0 ? "Studio" : `${app.beds} bed`}${app.baths ? ` · ${app.baths} bath` : ""}` : `Unit ${app.unit}`],
            [Ruler, "Size", app.sqft ? `${app.sqft.toLocaleString("en-US")} sq ft` : "—"],
            [CircleDollarSign, "Rent", app.rent_cents != null ? <Money key="r" value={app.rent_cents} cents style="whole" /> : "—"],
            [CalendarDays, "Move-in", day(app.desired_move_in) ?? "Flexible"],
          ].map(([Icon, k, v]) => {
            const I = Icon as typeof BedDouble;
            return (
              <div key={k as string} className="bg-card px-4 py-3">
                <dt className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><I className="size-3.5" aria-hidden />{k as string}</dt>
                <dd className="mt-0.5 text-[14px] font-semibold tabular-nums">{v as React.ReactNode}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section aria-labelledby="st-h" className="rounded-xl border bg-card p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id="st-h" className="text-[14.5px] font-semibold">Application status</h2>
          <StatusBadge value={app.stage} tone={TONE[app.stage]} label={app.stage === "Started" ? "Not submitted yet" : undefined} />
        </div>
        {app.stage === "Withdrawn" ? <p className="text-[13px] text-muted-foreground">This application was withdrawn.</p> : <Timeline steps={steps} />}
        <div className="mt-4 rounded-lg bg-muted/50 p-3">
          <p className="text-[12px] font-medium text-muted-foreground">What happens next</p>
          <p className="mt-0.5 text-[13.5px] text-pretty">{NEXT[app.stage] ?? "The leasing team will be in touch."}</p>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <section aria-labelledby="need-h" className="rounded-xl border bg-card p-4 md:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="need-h" className="text-[14.5px] font-semibold">{missing.length ? `Still needed (${missing.length})` : "Everything we need"}</h2>
            <Button asChild size="sm" variant={missing.length ? "default" : "outline"}><Link href="/portal/applicant/documents">{missing.length ? "Upload documents" : "View documents"}<ArrowRight /></Link></Button>
          </div>
          <ul className="space-y-2">
            {list.map((x) => (
              <li key={x.type} className="flex items-center gap-2.5 text-[13px]">
                <FileCheck2 className={x.doc ? "size-4 text-tone-success" : "size-4 text-muted-foreground"} aria-hidden />
                <span className={x.doc ? "text-muted-foreground line-through decoration-muted-foreground/40" : "font-medium"}>{x.type}</span>
                <span className="ml-auto text-[12px] text-muted-foreground">{x.doc ? `Received ${day(x.doc.uploaded_at)}` : "Needed"}</span>
              </li>
            ))}
            <li className="flex items-center gap-2.5 border-t pt-2 text-[13px]">
              <CircleDollarSign className={app.fee_paid ? "size-4 text-tone-success" : "size-4 text-muted-foreground"} aria-hidden />
              <span className={app.fee_paid ? "text-muted-foreground" : "font-medium"}>Application fee</span>
              {app.fee_paid ? <span className="ml-auto text-[12px] text-muted-foreground">Paid</span> : <Link href="/portal/applicant/pay" className="ml-auto text-[12px] font-medium text-primary hover:underline">Pay now</Link>}
            </li>
          </ul>
        </section>
        <PortalAsk title="Questions about your application?" prompts={c.persona.assistantPrompts} placeholder="Ask about your application…" />
      </div>
    </div>
  );
}
