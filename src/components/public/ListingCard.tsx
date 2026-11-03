import Link from "next/link";
/* eslint-disable @next/next/no-img-element -- every photo ships pre-sized (400 px thumbnail + full WebP), so plain lazy <img> with fixed dimensions is enough and works the same on the Workers build */
import { BadgePercent, PawPrint, TrendingDown } from "lucide-react";
import { bathLabel, bedLabel, homeKind } from "./catalog";
import { availableText, Pill, usd } from "./chrome";
import { thumb, type ListingCard as Card } from "./data";

// Photo card for the results grid. Images are the 400 px thumbnails, lazy-loaded except the first row.
export function ListingCard({ l, today, eager }: { l: Card; today: string; eager?: boolean }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring">
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <img
          src={thumb(l.photo)}
          alt={`${l.property}, ${l.neighborhood}`}
          width={400}
          height={300}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={eager ? "high" : undefined}
          className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
        />
        <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5">
          {l.special && <Pill tone="success" className="bg-background/95 shadow-sm"><BadgePercent className="size-3.5" aria-hidden />{l.special}</Pill>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[20px] font-semibold tracking-tight tabular-nums">{usd(l.rent_cents)}<span className="text-[13px] font-normal text-muted-foreground">/mo</span></span>
          {l.prev_rent_cents && (
            <span className="inline-flex items-center gap-0.5 text-[12.5px] font-medium text-tone-success">
              <TrendingDown className="size-3.5" aria-hidden />
              <span className="sr-only">Price reduced from </span><s className="tabular-nums">{usd(l.prev_rent_cents)}</s>
            </span>
          )}
        </div>
        <p className="text-[14px] font-medium tabular-nums">
          {bedLabel(l.beds)} · {bathLabel(l.baths)} · {l.sqft.toLocaleString("en-US")} sq ft
        </p>
        <h3 className="text-[14px] leading-snug text-muted-foreground">
          <Link href={`/listings/${l.id}`} className="outline-none after:absolute after:inset-0 after:content-['']">
            <span className="text-foreground">{l.property}</span> · Unit {l.unit}
          </Link>
        </h3>
        <p className="text-[13px] text-muted-foreground">{l.neighborhood === l.city ? "" : `${l.neighborhood}, `}{l.city}, {l.state}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          <Pill tone={!l.available_on || l.available_on <= today ? "info" : "neutral"}>{availableText(l.available_on, today)}</Pill>
          <Pill>{homeKind(l.type)}</Pill>
          {l.pets && <Pill><PawPrint className="size-3" aria-hidden />Pets OK</Pill>}
        </div>
      </div>
    </article>
  );
}
