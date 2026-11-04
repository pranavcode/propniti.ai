"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Which sides of a horizontal scroller have hidden content, kept current on scroll and resize.
export function useScrollEdges(ref: React.RefObject<HTMLElement | null>) {
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [ref]);
  return edges;
}

// Soft shadows on the sides that hide columns, so a wide table says it scrolls.
export function EdgeFades({ left, right, className }: { left: boolean; right: boolean; className?: string }) {
  return (
    <>
      <span aria-hidden className={cn("pointer-events-none absolute inset-y-0 left-0 z-10 w-5 bg-linear-to-r from-foreground/[0.12] to-transparent transition-opacity", left ? "opacity-100" : "opacity-0", className)} />
      <span aria-hidden className={cn("pointer-events-none absolute inset-y-0 right-0 z-10 w-5 bg-linear-to-l from-foreground/[0.12] to-transparent transition-opacity", right ? "opacity-100" : "opacity-0", className)} />
    </>
  );
}

// A box whose content scrolls sideways inside it (wide tables on phones) instead of widening the page.
// The scroller is positioned, so screen-reader-only labels inside a table stay inside it too.
export function ScrollX({ className, children, ...rest }: React.ComponentProps<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(ref);
  return (
    <div {...rest} className={cn("relative min-w-0 overflow-hidden", className)}>
      <div ref={ref} className="relative overflow-x-auto overscroll-x-contain">{children}</div>
      <EdgeFades {...edges} />
    </div>
  );
}
