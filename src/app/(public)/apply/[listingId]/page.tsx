import type { Metadata } from "next";
/* eslint-disable @next/next/no-img-element -- every photo ships pre-sized (400 px thumbnail + full WebP), so plain lazy <img> with fixed dimensions is enough and works the same on the Workers build */
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { ApplyWizard } from "@/components/public/ApplyWizard";
import { bathLabel, bedLabel } from "@/components/public/catalog";
import { availableText, PublicFooter, PublicHeader, usd } from "@/components/public/chrome";
import { getListing, moveInCents, thumb, today, visitorWorkspace } from "@/components/public/data";

type Props = { params: Promise<{ listingId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { listingId } = await params;
  const l = await getListing(await visitorWorkspace(), listingId);
  // Application forms are never indexed.
  return { title: l ? `Apply for ${l.property} unit ${l.unit} · Propniti Rentals` : "Apply · Propniti Rentals", robots: { index: false, follow: false } };
}

export default async function Page({ params }: Props) {
  const { listingId } = await params;
  const l = await getListing(await visitorWorkspace(), listingId);
  if (!l) notFound();
  const now = today();
  const day = new Date(Date.parse(`${now}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const earliest = l.available_on && l.available_on > day ? l.available_on : day;

  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-6xl px-4 pt-6 text-[14px] sm:px-6">
        <Link href={`/listings/${l.id}`} className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" aria-hidden />Back to the listing</Link>
        <h1 className="text-balance mb-6 text-[26px] font-semibold tracking-tight">Apply for unit {l.unit}</h1>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <ApplyWizard listingId={l.id} leaseMonths={l.terms.lease_months} earliest={earliest} fee={usd(l.terms.application_fee_cents)} />
          <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start" aria-label="The home you're applying for">
            <div className="overflow-hidden rounded-2xl border bg-card">
              <img src={thumb(l.photo)} alt={l.property} width={400} height={300} className="aspect-[4/3] w-full object-cover" />
              <div className="flex flex-col gap-1 p-4">
                <p className="font-semibold">{l.property} · Unit {l.unit}</p>
                <p className="text-muted-foreground">{bedLabel(l.beds)} · {bathLabel(l.baths)} · {l.sqft.toLocaleString("en-US")} sq ft</p>
                <p className="text-muted-foreground">{availableText(l.available_on, now)}</p>
                <dl className="mt-3 flex flex-col gap-1.5 border-t pt-3">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Rent</dt><dd className="font-medium tabular-nums">{usd(l.rent_cents)}/mo</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Due before move-in</dt><dd className="font-medium tabular-nums">{usd(moveInCents(l))}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Application fee</dt><dd className="font-medium tabular-nums">{usd(l.terms.application_fee_cents)} per adult</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Income guideline</dt><dd className="font-medium tabular-nums">{usd(l.rent_cents * l.terms.income_multiple)}/mo</dd></div>
                </dl>
              </div>
            </div>
            <div className="flex gap-3 rounded-2xl border p-4 text-[13px] text-muted-foreground">
              <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden />
              <p>Every application is reviewed against the same written criteria. Our AI drafts a screening summary with reasons for and against; a person makes the decision.</p>
            </div>
          </aside>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
