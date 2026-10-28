"use client";

import { useEffect, useRef, useState } from "react";

// Heavy fade-up as the element enters the viewport (transform/opacity/filter only).
export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-[opacity,transform,filter] duration-[1000ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${
        shown ? "translate-y-0 opacity-100 blur-0" : "translate-y-12 opacity-0 blur-[6px] motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:blur-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}
