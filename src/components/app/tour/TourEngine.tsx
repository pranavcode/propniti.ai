"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readLocal, writeLocal } from "@/hooks/use-local-storage";
import type { TourDef, TourProgress, TourStore } from "./types";

// Lightweight product tour: spotlight a [data-tour] element, show a step card, skip or resume.

export const localTourStore: TourStore = {
  get: (tour) => readLocal<Record<string, TourProgress>>("pn_tours", {})[tour] ?? null,
  set: (p) => writeLocal("pn_tours", { ...readLocal<Record<string, TourProgress>>("pn_tours", {}), [p.tour]: p }),
};

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;

function findTarget(target?: string) {
  if (!target) return null;
  const els = document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`);
  for (const el of els) { const r = el.getBoundingClientRect(); if (r.width && r.height) return el; }
  return null;
}

export function useTour(tours: TourDef[], store: TourStore = localTourStore) {
  const [active, setActive] = useState<{ tour: TourDef; step: number } | null>(null);

  const save = useCallback((tour: string, step: number, status: TourProgress["status"]) => store.set({ tour, step, status, updatedAt: new Date().toISOString() }), [store]);

  const start = useCallback((id?: string) => {
    const tour = tours.find((t) => t.id === id) ?? tours[0];
    if (!tour) return;
    const p = store.get(tour.id);
    // Resume where the visitor left off unless they finished it.
    const step = p && p.status !== "Completed" && p.step < tour.steps.length ? p.step : 0;
    setActive({ tour, step });
    save(tour.id, step, "Active");
  }, [tours, store, save]);

  const go = useCallback((step: number) => setActive((a) => {
    if (!a) return a;
    if (step >= a.tour.steps.length) { save(a.tour.id, a.tour.steps.length, "Completed"); return null; }
    save(a.tour.id, step, "Active");
    return { ...a, step: Math.max(0, step) };
  }), [save]);

  const dismiss = useCallback(() => setActive((a) => { if (a) save(a.tour.id, a.step, "Dismissed"); return null; }), [save]);

  // First visit: offer the first tour once.
  useEffect(() => {
    const first = tours[0];
    if (!first || store.get(first.id)) return;
    const t = setTimeout(() => start(first.id), 1200);
    return () => clearTimeout(t);
  }, [tours, store, start]);

  return { active, start, go, dismiss };
}

export function TourOverlay({ active, go, dismiss }: Pick<ReturnType<typeof useTour>, "active" | "go" | "dismiss">) {
  const router = useRouter();
  const pathname = usePathname();
  const [rect, setRect] = useState<Rect | null>(null);
  const step = active?.tour.steps[active.step];

  useEffect(() => {
    if (step?.href && pathname !== step.href.split("?")[0]) router.push(step.href);
  }, [step, pathname, router]);

  useLayoutEffect(() => {
    if (!step) return;
    let raf = 0;
    const measure = () => {
      const el = findTarget(step.target);
      const r = el?.getBoundingClientRect();
      setRect((prev) => {
        if (!r) return prev === null ? prev : null;
        if (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height) return prev;
        return { top: r.top, left: r.left, width: r.width, height: r.height };
      });
      raf = requestAnimationFrame(measure);
    };
    findTarget(step.target)?.scrollIntoView({ block: "nearest" });
    measure();
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
      if (e.key === "ArrowRight") go(active.step + 1);
      if (e.key === "ArrowLeft") go(active.step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, go, dismiss]);

  if (!active || !step) return null;
  const n = active.tour.steps.length;
  const W = 320;
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  let pos: React.CSSProperties = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  if (rect) {
    const place = step.placement ?? (rect.top > vh / 2 ? "top" : "bottom");
    const clampX = (x: number) => Math.max(12, Math.min(vw - W - 12, x));
    const clampY = (y: number) => Math.max(12, Math.min(vh - 220, y));
    if (place === "right") pos = { top: clampY(rect.top), left: Math.min(vw - W - 12, rect.left + rect.width + 14) };
    else if (place === "left") pos = { top: clampY(rect.top), left: Math.max(12, rect.left - W - 14) };
    else if (place === "top") pos = { bottom: vh - rect.top + 14, left: clampX(rect.left + rect.width / 2 - W / 2) };
    else pos = { top: rect.top + rect.height + 14, left: clampX(rect.left + rect.width / 2 - W / 2) };
    // Tall targets (the sidebar): pin the card near the top of the target.
    if (place === "right" && rect.height > vh * 0.6) pos.top = 96;
  }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={`${active.tour.title}: step ${active.step + 1} of ${n}`}>
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-lg ring-2 ring-primary transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: "0 0 0 9999px oklch(0.15 0.01 265 / 0.5)" }}
        />
      ) : (
        <div className="fixed inset-0 bg-[oklch(0.15_0.01_265/0.5)]" />
      )}
      <div style={{ ...pos, width: W }} className="fixed rounded-xl border bg-popover p-4 text-popover-foreground shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-medium text-primary">{active.tour.title}</span>
          <button onClick={dismiss} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Skip tour"><X className="size-3.5" /></button>
        </div>
        <h3 className="text-[15px] font-semibold tracking-tight">{step.title}</h3>
        <p className="mt-1 leading-relaxed text-muted-foreground">{step.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex gap-1">{Array.from({ length: n }, (_, i) => <span key={i} className={i === active.step ? "h-1.5 w-4 rounded-full bg-primary" : "size-1.5 rounded-full bg-border"} />)}</div>
          <div className="ml-auto flex gap-1.5">
            {active.step === 0 ? <Button size="sm" variant="ghost" onClick={dismiss}>Skip</Button> : <Button size="sm" variant="ghost" onClick={() => go(active.step - 1)}>Back</Button>}
            <Button size="sm" onClick={() => go(active.step + 1)}>{active.step === n - 1 ? "Done" : active.step === 0 ? "Start tour" : "Next"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
