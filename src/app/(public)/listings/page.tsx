import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { PublicFooter, PublicHeader } from "@/components/public/chrome";
import { metroSummary, parseFilters, searchListings, SORTS, today, visitorWorkspace, type Filters as F, type SearchParams } from "@/components/public/data";
import { Filters } from "@/components/public/Filters";
import { ListingCard } from "@/components/public/ListingCard";
import { MetroChooser } from "@/components/public/MetroChooser";
import { Pagination } from "@/components/public/Pagination";
import { Button } from "@/components/ui/button";

type Props = { searchParams: Promise<SearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const f = parseFilters(await searchParams);
  const where = f.metro ? ` in ${f.metro}` : " in Austin, Dallas, Atlanta and Phoenix";
  return {
    title: `Apartments and homes for rent${where} · Propniti Rentals`,
    description: `Browse homes for rent${where} with real photos, floor plans, prices, move-in costs and specials. Book a tour or apply online.`,
    alternates: { canonical: f.metro ? `/listings?metro=${f.metro}` : "/listings" },
    // Filtered and paged variations stay out of the index; the metro pages are the canonical ones.
    robots: f.q || f.beds.length || f.min || f.max || f.pets || f.amenities.length || f.available || f.page > 1 ? { index: false, follow: true } : undefined,
  };
}

function hrefWith(f: F, over: Partial<F>) {
  const v = { ...f, ...over };
  const qs = new URLSearchParams();
  if (v.q) qs.set("q", v.q);
  if (v.metro) qs.set("metro", v.metro);
  if (v.beds.length) qs.set("beds", v.beds.join(","));
  if (v.min != null) qs.set("min", String(v.min));
  if (v.max != null) qs.set("max", String(v.max));
  if (v.pets) qs.set("pets", "1");
  if (v.amenities.length) qs.set("amenities", v.amenities.join(","));
  if (v.available) qs.set("available", v.available);
  if (v.sort !== "newest") qs.set("sort", v.sort);
  if (v.page > 1) qs.set("page", String(v.page));
  return `/listings${qs.size ? `?${qs}` : ""}`;
}

export default async function Page({ searchParams }: Props) {
  const f = parseFilters(await searchParams);
  const ws = await visitorWorkspace();
  const [result, metros] = await Promise.all([searchListings(ws, f), metroSummary(ws)]);
  const now = today();
  const filtered = !!(f.q || f.metro || f.beds.length || f.min != null || f.max != null || f.pets || f.amenities.length || f.available);

  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto max-w-7xl flex flex-col gap-6 px-4 pt-6 text-[14px] sm:px-6 sm:pt-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-balance text-[26px] font-semibold tracking-tight sm:text-[32px]">{f.metro ? `Homes for rent in ${f.metro}` : "Find your next home"}</h1>
          <p className="max-w-2xl text-[15px] text-muted-foreground">Real prices with the full move-in cost, floor plans and current specials. Ask our AI anything about a home, no account needed.</p>
        </div>

        <MetroChooser metros={metros} active={f.metro} hrefFor={(m) => hrefWith(f, { metro: m as F["metro"], page: 1 })} />

        <Filters value={f} total={result.total} sorts={Object.entries(SORTS).map(([key, s]) => ({ key, label: s.label }))} />

        {result.rows.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {result.rows.map((l, i) => <li key={l.id} className="flex"><ListingCard l={l} today={now} eager={i < 4} /></li>)}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-16 text-center">
            <SearchX className="size-8 text-muted-foreground" aria-hidden />
            <h2 className="text-[17px] font-semibold">{filtered ? "No homes match these filters" : "No homes are listed right now"}</h2>
            <p className="max-w-md text-muted-foreground">{filtered ? "Try a wider price range, fewer amenities or another metro." : "New homes are listed every week. Check back soon."}</p>
            {filtered && <Button asChild variant="outline" className="mt-1 h-10 px-4"><Link href="/listings">Clear filters</Link></Button>}
          </div>
        )}

        <Pagination page={result.page} total={result.total} size={result.size} hrefFor={(p) => hrefWith(f, { page: p })} />
      </main>
      <PublicFooter />
    </>
  );
}
