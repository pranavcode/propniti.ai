"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AMENITY_FILTERS, METROS } from "./catalog";

export type FilterState = { q: string; metro: string; beds: number[]; min: number | null; max: number | null; pets: boolean; amenities: string[]; available: string; sort: string };

const BEDS = [{ v: 0, label: "Studio" }, { v: 1, label: "1" }, { v: 2, label: "2" }, { v: 3, label: "3+" }];
const field = "h-10 w-full rounded-lg border border-input bg-background px-3 text-[14px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40";

// A plain GET form (works before JavaScript loads); once hydrated, every change navigates
// client-side and keeps the scroll position. Changing a filter goes back to page 1.
export function Filters({ value, sorts, total }: { value: FilterState; sorts: { key: string; label: string }[]; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  // Inputs are uncontrolled; each one remounts when its URL value changes from outside (metro map,
  // Clear all). The search box only remounts on Clear all, so typing never loses focus.
  const [reset, setReset] = useState(0);

  function apply(delay = 0) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const fd = new FormData(form.current!);
      const qs = new URLSearchParams();
      for (const key of new Set(fd.keys())) {
        const vals = fd.getAll(key).map(String).filter(Boolean);
        if (vals.length) qs.set(key, vals.join(","));
      }
      start(() => router.replace(`${pathname}${qs.size ? `?${qs}` : ""}`, { scroll: false }));
    }, delay);
  }

  const active = [value.beds.length, value.min != null, value.max != null, value.pets, value.amenities.length, value.available].filter(Boolean).length;

  return (
    <form
      ref={form}
      action={pathname}
      method="get"
      role="search"
      onSubmit={(e) => (e.preventDefault(), apply())}
      onChange={(e) => apply(["search", "number"].includes((e.target as HTMLElement).getAttribute("type") ?? "") ? 450 : 0)}
      className="space-y-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search by city, neighborhood, ZIP or community</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input key={reset} type="search" name="q" defaultValue={value.q} placeholder="City, neighborhood, ZIP or community…" autoComplete="off" className={cn(field, "h-11 pl-9 text-[15px]")} />
        </label>
        <div className="flex gap-2">
          <label className="flex-1 sm:w-40">
            <span className="sr-only">Metro</span>
            <select key={value.metro} name="metro" defaultValue={value.metro} className={cn(field, "h-11")}>
              <option value="">All metros</option>
              {METROS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="more-filters" className="inline-flex h-11 items-center gap-2 rounded-lg border bg-background px-3 text-[14px] font-medium hover:bg-muted lg:hidden">
            <SlidersHorizontal className="size-4" aria-hidden />Filters{active ? <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground tabular-nums">{active}</span> : null}
          </button>
        </div>
      </div>

      <div id="more-filters" className={cn("grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end lg:border-0 lg:bg-transparent lg:p-0", !open && "hidden lg:flex")}>
        <fieldset className="min-w-0">
          <legend className="mb-1 text-[12px] font-medium text-muted-foreground">Bedrooms</legend>
          <div className="flex overflow-hidden rounded-lg border">
            {BEDS.map((b) => (
              <label key={b.v} className="relative flex-1 lg:flex-none">
                <input key={String(value.beds.includes(b.v))} type="checkbox" name="beds" value={b.v} defaultChecked={value.beds.includes(b.v)} className="peer sr-only" />
                <span className="flex h-10 min-w-12 cursor-pointer items-center justify-center border-r px-3 text-[13.5px] last:border-r-0 peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-inset hover:bg-muted peer-checked:hover:bg-primary">{b.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="mb-1 text-[12px] font-medium text-muted-foreground">Monthly rent</legend>
          <div className="flex items-center gap-1.5">
            <input key={`min${value.min}`} type="number" name="min" inputMode="numeric" min={0} step={50} defaultValue={value.min ?? ""} placeholder="Min $" aria-label="Minimum rent" className={cn(field, "w-24 tabular-nums")} />
            <span className="text-muted-foreground" aria-hidden>–</span>
            <input key={`max${value.max}`} type="number" name="max" inputMode="numeric" min={0} step={50} defaultValue={value.max ?? ""} placeholder="Max $" aria-label="Maximum rent" className={cn(field, "w-24 tabular-nums")} />
          </div>
        </fieldset>
        <label className="min-w-0">
          <span className="mb-1 block text-[12px] font-medium text-muted-foreground">Move in by</span>
          <input key={value.available} type="date" name="available" defaultValue={value.available} className={cn(field, "lg:w-40")} />
        </label>
        <label className="flex h-10 cursor-pointer items-center gap-2 self-end rounded-lg border bg-background px-3 text-[13.5px] has-checked:border-primary has-checked:bg-primary/5">
          <input key={String(value.pets)} type="checkbox" name="pets" value="1" defaultChecked={value.pets} className="size-4 accent-[var(--primary)]" />Pets allowed
        </label>
        <details className="group relative self-end sm:col-span-2 lg:col-span-1">
          <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-lg border bg-background px-3 text-[13.5px] hover:bg-muted [&::-webkit-details-marker]:hidden">
            Amenities{value.amenities.length ? <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground tabular-nums">{value.amenities.length}</span> : null}
          </summary>
          <div className="mt-1 grid grid-cols-2 gap-1 rounded-xl border bg-popover p-2 shadow-lg lg:absolute lg:z-20 lg:w-80">
            {Object.entries(AMENITY_FILTERS).map(([k, a]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] hover:bg-muted">
                <input key={`${k}${value.amenities.includes(k)}`} type="checkbox" name="amenities" value={k} defaultChecked={value.amenities.includes(k)} className="size-4 accent-[var(--primary)]" />{a.label}
              </label>
            ))}
          </div>
        </details>
        <noscript><button type="submit" className="h-10 rounded-lg bg-primary px-4 text-primary-foreground">Search</button></noscript>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="flex items-center gap-2 text-[14px]" aria-live="polite">
          <span className="font-semibold tabular-nums">{total.toLocaleString("en-US")}</span> {total === 1 ? "home" : "homes"} for rent
          {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating results" />}
        </p>
        <div className="flex items-center gap-2">
          {(active > 0 || value.q || value.metro) && (
            <button type="button" onClick={() => (setReset((r) => r + 1), start(() => router.replace(pathname, { scroll: false })))} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-3.5" aria-hidden />Clear all
            </button>
          )}
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            Sort
            <select key={value.sort} name="sort" defaultValue={value.sort} className={cn(field, "h-9 w-auto")}>
              {sorts.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>
      </div>
    </form>
  );
}
