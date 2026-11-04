import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { BadgePercent, Bath, BedDouble, Building2, CalendarDays, Car, ChevronRight, Check, PawPrint, Ruler, Shirt, TrendingDown, UserRound } from "lucide-react";
import { getPlatform } from "@/lib/platform";
import { AskUnit } from "@/components/public/AskUnit";
import { bathLabel, bedLabel, homeKind, neighborhoodBlurb } from "@/components/public/catalog";
import { availableText, Pill, PublicFooter, PublicHeader, usd } from "@/components/public/chrome";
import { getListing, leasingAgent, moveInCents, renterHelp, today, tourSlots, visitorWorkspace } from "@/components/public/data";
import { FloorPlan } from "@/components/public/FloorPlan";
import { Gallery, type Photo } from "@/components/public/Gallery";
import { ListingCard } from "@/components/public/ListingCard";
import { TourForm } from "@/components/public/TourForm";
import { Button } from "@/components/ui/button";


type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const l = await getListing(await visitorWorkspace(), id);
  if (!l) return { title: "Home not found · Propniti Rentals", robots: { index: false } };
  const title = `${bedLabel(l.beds)}, ${bathLabel(l.baths)} ${homeKind(l.type).toLowerCase()} for rent in ${l.neighborhood}, ${l.city} · ${usd(l.rent_cents)}/mo`;
  const description = `Unit ${l.unit} at ${l.property}, ${l.street}, ${l.city}, ${l.state}. ${l.sqft.toLocaleString("en-US")} sq ft, ${availableText(l.available_on, today()).toLowerCase()}.${l.specials.length ? ` Special: ${l.specials[0].label}.` : ""}`;
  return {
    title, description, alternates: { canonical: `/listings/${l.id}` },
    openGraph: { title, description, type: "website", images: [{ url: l.property_photos[0] ?? l.photo, width: 1600, height: 1200, alt: l.property }] },
  };
}

const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function Page({ params }: Props) {
  const { id } = await params;
  const ws = await visitorWorkspace();
  const l = await getListing(ws, id);
  if (!l) notFound();
  const [help, agent] = await Promise.all([renterHelp(ws), leasingAgent(getPlatform().db, ws, l.property_id)]);
  const now = today();
  const photos: Photo[] = [
    ...l.property_photos.slice(0, 2).map((src, i) => ({ src, alt: i === 0 ? `${l.property} exterior` : `${l.property}, another view`, group: "Property" as const })),
    ...l.unit_photos.map((src) => ({ src, alt: `Inside a ${l.plan} home: ${src.match(/-(living|kitchen|bedroom|bathroom)\./)?.[1] ?? "interior"}`, group: "Home" as const })),
    ...l.property_photos.slice(2).map((src) => ({ src, alt: `${l.property} ${/court/.test(src) ? "courtyard" : /interior/.test(src) ? "common area" : "view"}`, group: "Property" as const })),
  ];
  const moveIn = moveInCents(l);
  const t = l.terms;
  const facts = [
    { icon: BedDouble, label: "Bedrooms", value: l.beds === 0 ? "Studio" : String(l.beds) },
    { icon: Bath, label: "Bathrooms", value: String(l.baths) },
    { icon: Ruler, label: "Size", value: `${l.sqft.toLocaleString("en-US")} sq ft` },
    { icon: Building2, label: "Floor", value: l.floor ? `${l.floor}${l.stories ? ` of ${l.stories}` : ""}` : "Ground" },
    { icon: CalendarDays, label: "Available", value: !l.available_on || l.available_on <= now ? "Now" : fmtDate(l.available_on) },
    { icon: PawPrint, label: "Pets", value: t.pets.allowed ? "Cats and dogs OK" : "No pets" },
    { icon: Car, label: "Parking", value: t.parking ? t.parking.replace(/ included.*$/, " included") : "Ask on tour" },
    { icon: Shirt, label: "Laundry", value: t.laundry ? "In-home washer/dryer" : "Ask on tour" },
  ];

  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-7xl px-4 pt-4 text-[14px] sm:px-6 sm:pt-6">
        <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1">
            <li><Link href="/listings" className="hover:text-foreground">Homes</Link></li>
            <li aria-hidden><ChevronRight className="size-3.5" /></li>
            <li><Link href={`/listings?metro=${l.metro}`} className="hover:text-foreground">{l.metro}</Link></li>
            <li aria-hidden><ChevronRight className="size-3.5" /></li>
            <li><Link href={`/listings?q=${encodeURIComponent(l.property)}`} className="hover:text-foreground">{l.property}</Link></li>
            <li aria-hidden><ChevronRight className="size-3.5" /></li>
            <li aria-current="page" className="text-foreground">Unit {l.unit}</li>
          </ol>
        </nav>

        <Gallery photos={photos} />

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 flex flex-col gap-8">
            <header className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                <Pill tone={!l.available_on || l.available_on <= now ? "info" : "neutral"}>{availableText(l.available_on, now)}</Pill>
                <Pill>{homeKind(l.type)}</Pill>
                {l.prev_rent_cents && <Pill tone="success"><TrendingDown className="size-3.5" aria-hidden />Price reduced</Pill>}
              </div>
              <h1 className="text-balance text-[24px] leading-tight font-semibold tracking-tight sm:text-[30px]">{l.headline}</h1>
              <p className="text-[15px] text-muted-foreground">{l.property} · Unit {l.unit} · {l.street}, {l.city}, {l.state} {l.zip}</p>
            </header>

            <dl className="grid grid-cols-2 overflow-hidden rounded-xl border sm:grid-cols-4 [&>div]:border-b [&>div]:border-r [&>div:nth-child(2n)]:border-r-0 sm:[&>div:nth-child(2n)]:border-r sm:[&>div:nth-child(4n)]:border-r-0 [&>div:nth-last-child(-n+2)]:border-b-0 sm:[&>div:nth-last-child(-n+4)]:border-b-0">
              {facts.map((f) => (
                <div key={f.label} className="relative min-w-0 py-3 pr-3 pl-9">
                  <dt className="text-[12px] text-muted-foreground"><f.icon className="absolute top-3.5 left-3 size-4 text-muted-foreground" aria-hidden />{f.label}</dt>
                  <dd className="text-[14px] font-semibold text-pretty">{f.value}</dd>
                </div>
              ))}
            </dl>

            {l.specials.length > 0 && (
              <section aria-labelledby="specials" className="rounded-2xl border border-tone-success/30 bg-tone-success/[0.06] p-4 sm:p-5">
                <h2 id="specials" className="flex items-center gap-2 text-[16px] font-semibold"><BadgePercent className="size-5 text-tone-success" aria-hidden />Specials and concessions</h2>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {l.specials.map((s) => (
                    <li key={s.label} className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
                      <span className="font-medium">{s.label}</span>
                      {s.amount_cents > 0 && <span className="text-muted-foreground tabular-nums">worth about {usd(s.amount_cents)}</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[12.5px] text-muted-foreground">Applies to new leases signed while the special is listed. The leasing team confirms the final amount on your lease.</p>
              </section>
            )}

            <AskUnit listingId={l.id} unit={l.unit} />

            <section aria-labelledby="about" className="flex flex-col gap-2">
              <h2 id="about" className="text-[18px] font-semibold">About this home</h2>
              <p className="text-[15px] leading-relaxed">{l.description}</p>
              <p className="text-[15px] leading-relaxed text-muted-foreground">{l.property} is a {l.class ? `class ${l.class} ` : ""}{l.type.toLowerCase()} community{l.year_built ? ` built in ${l.year_built}` : ""}{l.stories ? `, ${l.stories} ${l.stories === 1 ? "story" : "stories"}` : ""}.</p>
            </section>

            <section aria-labelledby="plan" className="grid gap-6 rounded-2xl border bg-card p-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] sm:p-5">
              <div>
                <h2 id="plan" className="mb-3 text-[18px] font-semibold">Floor plan {l.plan}</h2>
                <FloorPlan beds={l.beds} baths={l.baths} sqft={l.sqft} plan={l.plan} />
              </div>
              <div className="flex flex-col gap-3">
                <h3 className="text-[15px] font-semibold">Lease terms</h3>
                <p className="text-muted-foreground">{t.lease_months.join(", ")} months.</p>
                <h3 className="text-[15px] font-semibold">Utilities</h3>
                <p className="text-muted-foreground">{t.utilities}</p>
                <h3 className="text-[15px] font-semibold">Pets</h3>
                <p className="text-muted-foreground">{t.pets.allowed ? `${t.pets.note} ${usd(t.pets.deposit_cents)} refundable deposit and ${usd(t.pets.monthly_cents)}/month per pet.` : t.pets.note} Assistance animals are always welcome and never pay pet fees.</p>
              </div>
            </section>

            <section aria-labelledby="pricing" className="flex flex-col gap-3">
              <h2 id="pricing" className="text-[18px] font-semibold">Pricing and fees</h2>
              <div className="overflow-hidden rounded-2xl border">
                <table className="w-full text-[14px]">
                  <caption className="sr-only">Monthly and one-time costs for unit {l.unit}</caption>
                  <tbody className="divide-y">
                    <tr><th scope="row" className="px-4 py-2.5 text-left font-normal">Monthly rent</th><td className="px-4 py-2.5 text-right font-semibold tabular-nums">{usd(l.rent_cents)}</td></tr>
                    {l.parking.map((p) => <tr key={p.subtype}><th scope="row" className="px-4 py-2.5 text-left font-normal text-muted-foreground">{p.subtype} parking (optional, monthly)</th><td className="px-4 py-2.5 text-right tabular-nums">{usd(p.rent_cents)}</td></tr>)}
                    {l.storage_from_cents != null && <tr><th scope="row" className="px-4 py-2.5 text-left font-normal text-muted-foreground">Storage unit (optional, monthly)</th><td className="px-4 py-2.5 text-right tabular-nums">from {usd(l.storage_from_cents)}</td></tr>}
                    <tr><th scope="row" className="px-4 py-2.5 text-left font-normal">Application fee, per adult</th><td className="px-4 py-2.5 text-right tabular-nums">{usd(t.application_fee_cents)}</td></tr>
                    <tr><th scope="row" className="px-4 py-2.5 text-left font-normal">Security deposit</th><td className="px-4 py-2.5 text-right tabular-nums">{usd(t.deposit_cents)}</td></tr>
                    <tr><th scope="row" className="px-4 py-2.5 text-left font-normal">Administration fee (one-time)</th><td className="px-4 py-2.5 text-right tabular-nums">{usd(t.admin_fee_cents)}</td></tr>
                    <tr className="bg-muted/50"><th scope="row" className="px-4 py-3 text-left font-semibold">Due before move-in</th><td className="px-4 py-3 text-right text-[16px] font-semibold tabular-nums">{usd(moveIn)}</td></tr>
                  </tbody>
                </table>
              </div>
              {l.history.length > 1 && (
                <p className="text-[13px] text-muted-foreground">Price history: {[...l.history].reverse().map((h) => `${usd(h.rent_cents)} from ${fmtDate(h.changed_on)}`).join(" → ")}</p>
              )}
            </section>

            <section aria-labelledby="amenities" className="flex flex-col gap-3">
              <h2 id="amenities" className="text-[18px] font-semibold">Amenities</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {l.amenities.map((a) => <li key={a} className="flex items-center gap-2"><Check className="size-4 text-primary" aria-hidden />{a}</li>)}
                {t.laundry && !l.amenities.includes("In-unit laundry") && <li className="flex items-center gap-2"><Check className="size-4 text-primary" aria-hidden />{t.laundry}</li>}
              </ul>
            </section>

            <section aria-labelledby="hood" className="flex flex-col gap-2">
              <h2 id="hood" className="text-[18px] font-semibold">The neighborhood: {l.neighborhood}</h2>
              <p className="text-[15px] leading-relaxed">{neighborhoodBlurb(l.neighborhood, l.metro)}</p>
              {l.lat != null && l.lng != null && <p className="text-[13px] text-muted-foreground">{l.street}, {l.city}, {l.state} {l.zip} · {l.lat.toFixed(4)}, {l.lng.toFixed(4)}</p>}
            </section>

            <section aria-labelledby="help" className="flex flex-col gap-2">
              <h2 id="help" className="text-[18px] font-semibold">Renting with us</h2>
              <div className="divide-y rounded-2xl border">
                {help.map((h) => (
                  <details key={h.id} id={`help-${h.id}`} className="group scroll-mt-20 px-4 py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium [&::-webkit-details-marker]:hidden">{h.title}<ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden /></summary>
                    <p className="mt-2 leading-relaxed text-muted-foreground">{h.body}</p>
                  </details>
                ))}
              </div>
            </section>
          </div>

          <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start" aria-label="Price, apply and tour">
            <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm">
              <div>
                <p className="flex items-baseline gap-2">
                  <span className="text-[30px] font-semibold tracking-tight tabular-nums">{usd(l.rent_cents)}</span><span className="text-muted-foreground">/month</span>
                  {l.prev_rent_cents && <s className="text-[14px] text-muted-foreground tabular-nums">{usd(l.prev_rent_cents)}</s>}
                </p>
                <p className="text-[13px] text-muted-foreground">{bedLabel(l.beds)} · {bathLabel(l.baths)} · {l.sqft.toLocaleString("en-US")} sq ft · {usd(moveIn)} due before move-in</p>
                {l.specials[0] && <p className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-tone-success"><BadgePercent className="size-4" aria-hidden />{l.specials[0].label}</p>}
              </div>
              <Button asChild className="h-11 w-full text-[15px]"><Link href={`/apply/${l.id}`}>Apply now</Link></Button>
              <p className="-mt-2 text-center text-[12px] text-muted-foreground">About 10 minutes · {usd(t.application_fee_cents)} fee per adult</p>
              <div id="tour" className="scroll-mt-20 border-t pt-4">
                <h2 className="mb-3 text-[15px] font-semibold">Schedule a tour</h2>
                <TourForm listingId={l.id} slots={tourSlots()} />
              </div>
              {agent && <p className="flex items-center gap-2 border-t pt-3 text-[13px] text-muted-foreground"><UserRound className="size-4" aria-hidden />Your leasing contact: <span className="font-medium text-foreground">{agent.name}</span></p>}
            </div>
          </aside>
        </div>

        {l.siblings.length > 0 && (
          <section aria-labelledby="more" className="mt-12 flex flex-col gap-4">
            <h2 id="more" className="text-[18px] font-semibold">More homes at {l.property}</h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {l.siblings.map((s) => <li key={s.id} className="flex"><ListingCard l={s} today={now} /></li>)}
            </ul>
          </section>
        )}
      </main>
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <p className="min-w-0 flex-1 leading-tight"><span className="text-[18px] font-semibold tabular-nums">{usd(l.rent_cents)}</span><span className="text-[12px] text-muted-foreground">/mo</span><span className="block truncate text-[12px] text-muted-foreground">{availableText(l.available_on, now)}</span></p>
        <Button asChild variant="outline" className="h-10 px-3"><a href="#tour">Book tour</a></Button>
        <Button asChild className="h-10 px-4"><Link href={`/apply/${l.id}`}>Apply now</Link></Button>
      </div>
      <div className="h-16 lg:hidden" aria-hidden />
      <PublicFooter />
    </>
  );
}
