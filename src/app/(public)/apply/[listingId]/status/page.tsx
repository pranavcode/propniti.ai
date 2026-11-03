import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle, Loader2, Sparkles } from "lucide-react";
import { PublicFooter, PublicHeader, usd } from "@/components/public/chrome";
import { applicationStatus, getListing, visitorWorkspace } from "@/components/public/data";
import { Refresh } from "@/components/public/Refresh";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Application status · Propniti Rentals", robots: { index: false, follow: false } };

type Props = { params: Promise<{ listingId: string }>; searchParams: Promise<{ app?: string }> };

export default async function Page({ params, searchParams }: Props) {
  const [{ listingId }, { app }] = await Promise.all([params, searchParams]);
  const ws = await visitorWorkspace();
  // Only the visitor's own workspace holds their application, so another visitor's id finds nothing.
  const [l, a] = await Promise.all([getListing(ws, listingId), app ? applicationStatus(ws, app) : null]);
  if (!l || !a) notFound();
  const scored = !!a.proposal;
  const steps = [
    { title: "Application received", detail: `Submitted for ${l.property} unit ${l.unit}. Updates go to ${a.email}.`, done: true },
    { title: "Screening summary", detail: scored ? "The Leasing agent checked income, rental history and credit against the written criteria and drafted a summary with reasons for and against." : "The Leasing agent is checking income, rental history and credit against the written criteria.", done: scored, busy: !scored },
    { title: "A person decides", detail: "The managing broker reviews the summary and your documents and makes the decision, usually within 1 to 3 business days.", done: false },
    { title: "Sign your lease", detail: "Once approved, you'll get the lease to sign online and pay the deposit and first month's rent before move-in.", done: false },
  ];

  return (
    <>
      <PublicHeader />
      {!scored && <Refresh />}
      <main id="main" className="mx-auto max-w-3xl space-y-6 px-4 pt-8 text-[14px] sm:px-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-1 size-7 shrink-0 text-tone-success" aria-hidden />
          <div>
            <h1 className="text-balance text-[26px] font-semibold tracking-tight">Thanks, {a.first_name}. Your application is in.</h1>
            <p className="text-[15px] text-muted-foreground">Reference {a.id} · {l.property}, unit {l.unit} · {usd(l.rent_cents)}/mo</p>
          </div>
        </div>

        <section aria-labelledby="next" className="rounded-2xl border bg-card p-5">
          <h2 id="next" className="mb-4 text-[17px] font-semibold">What happens next</h2>
          <ol className="space-y-5">
            {steps.map((s, i) => (
              <li key={s.title} className="relative flex gap-3">
                {i < steps.length - 1 && <span className={cn("absolute top-7 left-[11px] h-[calc(100%-4px)] w-px", s.done ? "bg-tone-success/50" : "bg-border")} aria-hidden />}
                {s.done ? <CheckCircle2 className="size-6 shrink-0 text-tone-success" aria-hidden /> : s.busy ? <Loader2 className="size-6 shrink-0 animate-spin text-tone-ai" aria-hidden /> : <Circle className="size-6 shrink-0 text-muted-foreground/50" aria-hidden />}
                <div>
                  <p className="font-semibold">{s.title}<span className="sr-only">{s.done ? " (done)" : s.busy ? " (in progress)" : " (not started)"}</span></p>
                  <p className="text-muted-foreground">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="broker" className="rounded-2xl border border-tone-ai/25 bg-tone-ai/[0.04] p-5">
          <p className="mb-1 text-[12px] font-medium tracking-wide text-tone-ai uppercase">Demo: what the broker sees</p>
          <h2 id="broker" className="flex items-center gap-2 text-[17px] font-semibold"><Sparkles className="size-5 text-tone-ai" aria-hidden />AI screening summary</h2>
          {a.proposal ? (
            <div className="mt-3 space-y-3">
              <p className="font-medium">{a.proposal.title}</p>
              <ul className="space-y-1">
                {a.proposal.why.map((w) => (
                  <li key={w} className={cn("flex gap-2", w.startsWith("Against") ? "text-tone-warning" : w.startsWith("For") ? "text-tone-success" : "text-muted-foreground")}>
                    <span aria-hidden>{w.startsWith("Against") ? "−" : w.startsWith("For") ? "+" : "•"}</span><span className="text-foreground">{w.replace(/^(For|Against): /, "")}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[12.5px] text-muted-foreground">Confidence {Math.round(a.proposal.confidence * 100)}% · {a.proposal.model ? `model ${a.proposal.model}` : "rules"} · waiting for the broker&apos;s decision. The applicant never sees this panel in a real deployment.</p>
            </div>
          ) : (
            <p className="mt-3 text-muted-foreground">The Leasing agent is scoring this application now. This page updates by itself.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <form action="/api/session" method="post">
              <input type="hidden" name="persona" value="rachel" />
              <input type="hidden" name="next" value="/app/ai/approvals" />
              <button type="submit" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90">Open the broker&apos;s approvals</button>
            </form>
            {a.proposal?.run_id && (
              <form action="/api/session" method="post">
                <input type="hidden" name="persona" value="rachel" />
                <input type="hidden" name="next" value={`/app/ai/runs/${a.proposal.run_id}`} />
                <button type="submit" className="inline-flex h-10 items-center rounded-lg border bg-background px-4 font-medium hover:bg-muted">See the agent&apos;s steps</button>
              </form>
            )}
          </div>
        </section>

        <p className="text-muted-foreground">Questions? Ask the leasing team on your tour, or <Link href={`/listings/${l.id}`} className="font-medium text-primary underline-offset-2 hover:underline">go back to the listing</Link> to book a tour.</p>
      </main>
      <PublicFooter />
    </>
  );
}
