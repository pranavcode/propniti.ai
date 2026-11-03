"use client";

import { useEffect, useRef, useState } from "react";

// Content is visible in the server HTML. After hydration, only elements still below the fold are
// lowered and faded, then rise when they scroll in. Reduced motion skips the effect entirely.
export function Rise({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"static" | "waiting" | "shown">("static");

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setState("shown");
        io.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    // Lowering happens in a frame callback so the first paint never flashes hidden content.
    const raf = requestAnimationFrame(() => {
      setState("waiting");
      io.observe(el);
    });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      style={state === "shown" ? { transitionDelay: `${delay}ms` } : undefined}
      className={`${state === "static" ? "" : "transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"} ${state === "waiting" ? "translate-y-6 opacity-0" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
