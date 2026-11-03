"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { Persona } from "./content";
import { Photo } from "./ui";

// Who it's for: one persona at a time, photo-led. Tabs follow the WAI-ARIA tabs pattern
// (arrow keys move between tabs).
export function PersonaTabs({ personas }: { personas: Persona[] }) {
  const [i, setI] = useState(0);
  const p = personas[i];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : personas.length - 1)) % personas.length;
    setI(next);
    document.getElementById(`persona-tab-${personas[next].key}`)?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label="Who it's for" onKeyDown={onKey} className="flex gap-1 overflow-x-auto rounded-full bg-(--mk-bg-2) p-1 [scrollbar-width:none] sm:inline-flex">
        {personas.map((x, j) => (
          <button
            key={x.key}
            id={`persona-tab-${x.key}`}
            role="tab"
            aria-selected={i === j}
            aria-controls="persona-panel"
            tabIndex={i === j ? 0 : -1}
            onClick={() => setI(j)}
            className={`h-10 shrink-0 rounded-full px-4 text-[14px] font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-(--mk-teal) ${i === j ? "bg-white text-(--mk-text) shadow-sm" : "text-(--mk-muted) hover:text-(--mk-text)"}`}
          >
            {x.who}
          </button>
        ))}
      </div>

      <div id="persona-panel" role="tabpanel" aria-labelledby={`persona-tab-${p.key}`} className="mt-8 grid items-stretch gap-8 lg:grid-cols-[1.25fr_1fr]">
        <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-(--mk-bg-2) lg:aspect-auto lg:min-h-[420px]">
          {personas.map((x, j) => (
            <div key={x.key} aria-hidden={i !== j} className={`absolute inset-0 transition-opacity duration-500 ease-out ${i === j ? "opacity-100" : "opacity-0"}`}>
              <Photo src={x.img} alt={i === j ? x.alt : ""} sizes="(min-width: 1024px) 55vw, 100vw" />
            </div>
          ))}
        </div>
        <div key={p.key} className="flex flex-col justify-center motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
          <h3 className="text-balance text-[clamp(1.5rem,2.6vw,2.125rem)] font-semibold leading-[1.15] tracking-[-0.02em]">{p.title}</h3>
          <p className="mt-4 text-pretty text-[17px] leading-relaxed text-(--mk-muted)">{p.body}</p>
          <ul className="mt-6 flex flex-col gap-3 text-[15px]">
            {p.points.map((t) => (
              <li key={t} className="flex gap-3">
                <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-(--mk-teal)" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
