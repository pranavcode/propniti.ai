import Link from "@/components/Link";
import { ArrowRight, BedDouble, CalendarDays, CircleDollarSign, FileCheck2, Ruler, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money, StatusBadge } from "@/components/app/display";
import { portalCtx } from "@/extensions/owners/portal/context";
import { application, applicantMe, applicationDocs, checklist, journeyOf } from "@/extensions/owners/portal/applicant-data";
import { missingToSubmit, screeningChecks } from "@/extensions/owners/portal/journeys";
import { JourneySteps } from "@/extensions/owners/portal/ui/Journey";
import { SignLease } from "@/extensions/owners/portal/ui/applicant/SignLease";
import { SubmitApplication } from "@/extensions/owners/portal/ui/applicant/SubmitApplication";
import { PortalAsk } from "@/extensions/owners/portal/ui/PortalAsk";
import { NoApplication } from "@/extensions/owners/portal/ui/applicant/NoApplication";

const day = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null);
const hero = (photos: string, id: string) => {
  try {
    return (JSON.parse(photos) as string[])[0] ?? `/img/props/${id}.webp`;
  } catch {
    return `/img/props/${id}.webp`;
  }
};
const TONE: Record<string, "info" | "success" | "warning" | "danger" | "neutral"> = { Started: "neutral", Submitted: "info", Screening: "info", Review: "info", Approved: "success", Conditional: "warning", Denied: "danger", Leased: "success", Withdrawn: "neutral" };
const LABEL: Record<string, string> = { Started: "Not submitted yet", Review: "In review", Conditional: "Approved with conditions", Denied: "Not approved", Leased: "Lease signed" };
const CHECK: Record<string, { text: string; cls: string }> = {
  done: { text: "Done", cls: "bg-tone-success/10 text-tone-success" }, running: { text: "In progress", cls: "bg-tone-info/10 text-tone-info" },
  waiting: { text: "Not started", cls: "bg-muted text-muted-foreground" }, "needs-docs": { text: "Needs your documents", cls: "bg-tone-warning/10 text-tone-warning" },
};

// Applicant home: the home they applied for, a tracker from submission to move-in (with what
// happens next and what they must do), and the documents and fee. Screening results stay with the
// leasing team; the applicant sees which checks are done, never scores or flags.
export default async function ApplicantHome() {
  const c = await portalCtx("applicant");
  if (!c) return null;
  const [me, app] = await Promise.all([applicantMe(c), application(c)]);
  if (!app) return <NoApplication />;
  const docs = await applicationDocs(c, app.id);
  const list = checklist(docs);
  // Documents matter until the decision; after it, what's missing is no longer asked for.
  const docsOpen = ["Started", "Submitted", "Screening", "Review"].includes(app.stage);
  const missing = docsOpen ? list.filter((x) => !x.doc && !x.optional) : [];
  const journey = journeyOf(app, docs);
  const toSubmit = missingToSubmit({ fee_paid: app.fee_paid, docs: docs.map((d) => d.doc_type ?? "") });
  const checks = screeningChecks({ stage: app.stage, docs: docs.map((d) => d.doc_type ?? ""), screening: app.screening_done ? { completed_at: app.screening_done, income_verified: app.income_verified ?? 0 } : null });
  const name = me ? `${me.first_name} ${me.last_name}` : c.persona.name;
  const rent = app.rent_cents != null ? `$${(app.rent_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—";
  const action = app.stage === "Started"
    ? (toSubmit.length
      ? <>
          {toSubmit.some((x) => x !== "Application fee") && <Button asChild className="max-md:h-11"><Link href="/portal/applicant/documents"><Upload data-icon="inline-start" />Upload documents</Link></Button>}
          {toSubmit.includes("Application fee") && <Button asChild variant="outline" className="max-md:h-11"><Link href="/portal/applicant/pay"><CircleDollarSign data-icon="inline-start" />Pay the fee</Link></Button>}
        </>
      : <SubmitApplication me={c.me} />)
    : app.lease_sent_at && !app.lease_signed_at && (app.stage === "Approved" || app.stage === "Conditional")
      ? <SignLease me={c.me} terms={{ property: app.property, unit: app.unit, rent, moveIn: day(app.desired_move_in) ?? "Flexible", name }} />
      : journey.next.you && /upload/i.test(journey.next.you)
        ? <Button asChild variant="outline" className="max-md:h-11"><Link href="/portal/applicant/documents"><Upload data-icon="inline-start" />Upload documents</Link></Button>
        : null;
  const showChecks = !["Started", "Withdrawn"].includes(app.stage);

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
            [CalendarDays, app.move_in_on ? "Move-in" : "Requested move-in", day(app.move_in_on ?? app.desired_move_in) ?? "Flexible"],
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
          <h2 id="st-h" className="text-[14.5px] font-semibold">Your application, step by step</h2>
          <StatusBadge value={app.stage} tone={TONE[app.stage]} label={LABEL[app.stage]} />
        </div>
        <JourneySteps journey={journey} label="Application progress" action={action} />
        {showChecks && (
          <div className="mt-5 border-t pt-4">
            <p className="text-[12px] font-medium text-muted-foreground">Screening checks</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-3">
              {checks.map((k) => (
                <li key={k.key} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px]">
                  <span>{k.label}</span>
                  <span className={`inline-flex h-5 items-center rounded-full px-2 text-[11.5px] font-medium ${CHECK[k.state].cls}`}>{CHECK[k.state].text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-muted-foreground">You see whether each check is done. Scores and report details stay with the leasing team.</p>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <section aria-labelledby="need-h" className="rounded-xl border bg-card p-4 md:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="need-h" className="text-[14.5px] font-semibold">{missing.length ? `Documents still needed (${missing.length})` : "Documents"}</h2>
            <Button asChild size="sm" variant={missing.length ? "default" : "outline"}><Link href="/portal/applicant/documents">{missing.length ? "Upload documents" : "View documents"}<ArrowRight /></Link></Button>
          </div>
          <ul className="space-y-2">
            {list.map((x) => (
              <li key={x.type} className="flex items-center gap-2.5 text-[13px]">
                <FileCheck2 className={x.doc ? "size-4 text-tone-success" : "size-4 text-muted-foreground"} aria-hidden />
                <span className={x.doc ? "text-muted-foreground line-through decoration-muted-foreground/40" : x.optional || !docsOpen ? "text-muted-foreground" : "font-medium"}>{x.type}</span>
                <span className="ml-auto text-[12px] text-muted-foreground">{x.doc ? `Received ${day(x.doc.uploaded_at)}` : x.optional ? "Optional" : docsOpen ? "Needed" : "Not needed"}</span>
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
