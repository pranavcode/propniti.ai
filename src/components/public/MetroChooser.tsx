import Link from "next/link";
import { cn } from "@/lib/utils";
import { METRO_INFO, project, US_PATH, type Metro } from "./catalog";
import { usd } from "./chrome";

const W = 465;
const H = 260;

// A static map of the lower 48 with one marker per metro, in place of a live map: no third-party
// tiles or scripts. Markers and the list beside it are the same links.
export function MetroChooser({ metros, active, hrefFor }: { metros: { metro: string; n: number; from_cents: number }[]; active: string; hrefFor: (metro: string) => string }) {
  return (
    <section aria-label="Choose a metro" className="grid gap-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
      <div className="relative mx-auto hidden w-full max-w-[460px] sm:block">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Map of the United States with Austin, Dallas, Atlanta and Phoenix marked">
          <path d={US_PATH} className="fill-muted stroke-border" strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
        {metros.map((m) => {
          const { x, y } = project(METRO_INFO[m.metro as Metro].lon, METRO_INFO[m.metro as Metro].lat);
          const on = active === m.metro;
          return (
            <Link
              key={m.metro}
              href={hrefFor(on ? "" : m.metro)}
              aria-label={`${m.metro}: ${m.n} homes`}
              aria-current={on ? "true" : undefined}
              style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}
              className="group absolute -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={cn("absolute inset-0 -m-1.5 rounded-full bg-primary/20", on ? "animate-ping motion-reduce:animate-none" : "hidden")} aria-hidden />
              <span className={cn("relative flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold shadow-sm transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "bg-background text-foreground group-hover:border-primary")}>
                <span className={cn("size-1.5 rounded-full", on ? "bg-primary-foreground" : "bg-primary")} aria-hidden />
                {m.metro}
              </span>
            </Link>
          );
        })}
      </div>
      <ul className="grid grid-cols-2 gap-2 self-center">
        {metros.map((m) => {
          const on = active === m.metro;
          return (
            <li key={m.metro}>
              <Link
                href={hrefFor(on ? "" : m.metro)}
                aria-current={on ? "true" : undefined}
                className={cn("block rounded-xl border px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", on ? "border-primary bg-primary/5" : "hover:bg-muted")}
              >
                <span className="flex items-center justify-between text-[14px] font-semibold">{m.metro}<span className="text-[11.5px] font-normal text-muted-foreground">{METRO_INFO[m.metro as Metro].state}</span></span>
                <span className="block text-[12.5px] text-muted-foreground tabular-nums">{m.n} homes{m.n ? ` · from ${usd(m.from_cents)}` : ""}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
