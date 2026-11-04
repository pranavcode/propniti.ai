"use client";

import { useEffect, useState } from "react";
import type { TocEntry } from "@/lib/docs";

// spy: highlight the section being read (the last heading that has scrolled past the top bar).
export function TocList({ toc, spy = false }: { toc: TocEntry[]; spy?: boolean }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!spy) return;
    const heads = toc.map((t) => document.getElementById(t.id)).filter((h): h is HTMLElement => !!h);
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: string | null = null;
      for (const h of heads) {
        if (h.getBoundingClientRect().top > 120) break;
        current = h.id;
      }
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, [toc, spy]);

  return (
    <ol className="space-y-px text-[13px] leading-snug">
      {toc.map((t) => (
        <li key={t.id}>
          <a
            href={`#${t.id}`}
            aria-current={t.id === active ? "location" : undefined}
            className={`block rounded-r-md border-l-2 border-transparent py-1 pr-2 transition-colors hover:text-foreground aria-[current=location]:border-primary aria-[current=location]:text-primary ${
              t.depth === 3 ? "pl-5 text-muted-foreground" : "pl-2.5 text-foreground/80"
            }`}
          >
            {t.text}
          </a>
        </li>
      ))}
    </ol>
  );
}
