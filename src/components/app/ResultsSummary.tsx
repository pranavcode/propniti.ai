"use client";

import { useEffect, useRef } from "react";
import Link from "@/components/Link";
import { cn } from "@/lib/utils";

// After a filter click, the results may sit below the fold, so nothing seems to change near the
// pointer. Filter controls call pickFilter(); the next summary that renders with a new value
// scrolls the results into view. A page's first load never scrolls.
let picked = 0;
export const pickFilter = () => { picked = performance.now(); };

export function ResultsSummary({ text, clear, className }: { text?: string; clear?: string | (() => void); className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picked || performance.now() - picked > 10_000) return;
    picked = 0;
    const el = ref.current;
    const r = el?.getBoundingClientRect();
    if (!el || !r || (r.top >= 56 && r.top < window.innerHeight * 0.55)) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [text]);

  return (
    <div ref={ref} data-results-summary className={cn("scroll-mt-3", className)}>
      {text && (
        <p role="status" className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted-foreground">
          <span className="text-foreground">{text}</span>
          {clear && <span aria-hidden>·</span>}
          {typeof clear === "string" ? <Link href={clear} scroll={false} onClick={pickFilter} className="font-medium text-primary hover:underline">Clear</Link>
            : clear ? <button type="button" onClick={() => { pickFilter(); clear(); }} className="font-medium text-primary hover:underline">Clear</button> : null}
        </p>
      )}
    </div>
  );
}
