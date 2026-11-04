"use client";

import Link from "@/components/Link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { ChevronDown, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShell } from "../shell/context";
import { pageGuide } from "./pages";

// Top of the assistant panel when the chat bubble opened it: "What can I do here?" explains the
// current page in two lines, with links onward and its tour if it has one. Written by hand, not by a model.
export function PanelGuide() {
  const { data, crumbTitle, startTour } = useShell();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const id = useId();
  const g = pageGuide(pathname, { nav: data.nav.flatMap((s) => s.items), personaPrompts: [] });
  const tour = data.tours.find((t) => t.id !== "app-basics" && t.steps.some((s) => s.href?.split("?")[0] === pathname));

  return (
    <div className="shrink-0 border-b bg-muted/30 px-3 py-2">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 rounded text-left text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">On this page: <span className="font-medium text-foreground">{crumbTitle ?? g.title}</span></span>
        <span className="flex shrink-0 items-center gap-1 font-medium text-primary">What can I do here?<ChevronDown className={cn("size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-180")} /></span>
      </button>
      {open && (
        <div id={id} className="pt-1.5">
          <p className="text-[12.5px] leading-relaxed text-foreground/90">{g.about}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            {g.links.map((l) => <Link key={l.href} href={l.href} prefetch={false} className="text-primary hover:underline">{l.label}</Link>)}
            {tour && <button type="button" onClick={() => startTour(tour.id)} className="inline-flex items-center gap-1 text-primary hover:underline"><Compass className="size-3" />Tour this page</button>}
          </div>
        </div>
      )}
    </div>
  );
}
