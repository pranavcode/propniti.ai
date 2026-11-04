"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { navDone, navPhase, subscribeNav, trackRouter } from "./progress";

// Thin teal bar across the top of the app while the next page, filter or refresh loads. `commit`
// is the shell's children: a new value means the server's new render has committed.
export function NavProgress({ commit }: { commit: React.ReactNode }) {
  trackRouter();
  const phase = useSyncExternalStore(subscribeNav, navPhase, () => "idle" as const);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => { navDone(); }, [pathname, search, commit]);

  if (phase === "idle" || phase === "waiting") return null;
  return (
    <div aria-hidden data-nav-progress={phase} className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5">
      <div
        className={cn(
          "h-full origin-left bg-primary shadow-[0_0_6px_var(--primary)]",
          phase === "running"
            ? "scale-x-[0.85] transition-[scale] duration-[8000ms] ease-[cubic-bezier(0.1,0.7,0.2,1)] starting:scale-x-[0.12]"
            : "scale-x-100 opacity-0 [transition:scale_180ms_ease-out,opacity_200ms_ease-out_140ms]",
        )}
      />
    </div>
  );
}
