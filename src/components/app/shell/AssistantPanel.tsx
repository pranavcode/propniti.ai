"use client";

import Link from "next/link";
import { useCallback, useRef } from "react";
import { Maximize2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AskBox } from "../ai/AskBox";
import { useShell } from "./context";

export const AI_MIN_W = 340;
export const AI_MAX_W = 720;

// Right-side dock for the assistant. Lane E renders the conversation as `children`; until then a
// prompt with the persona's suggested questions stands in. Docked beside the page from xl up,
// overlaid on smaller screens. The left edge drags to resize.
export function AssistantPanel({ children, onResize }: { children?: React.ReactNode; onResize: (w: number) => void }) {
  const { assistant, data } = useShell();
  const dragging = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    onResize(Math.min(AI_MAX_W, Math.max(AI_MIN_W, window.innerWidth - e.clientX)));
  }, [onResize]);
  const onPointerUp = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  if (!assistant.open) return null;
  return (
    <aside
      aria-label="Ask Propniti"
      style={{ width: assistant.width }}
      className={cn(
        "relative flex h-full shrink-0 flex-col border-l bg-background",
        "max-xl:fixed max-xl:top-0 max-xl:right-0 max-xl:bottom-0 max-xl:z-40 max-xl:max-w-[100vw] max-xl:shadow-2xl",
        "animate-in slide-in-from-right-4 fade-in-0 duration-200 motion-reduce:animate-none",
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize assistant"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "ArrowLeft") onResize(Math.min(AI_MAX_W, assistant.width + 24)); if (e.key === "ArrowRight") onResize(Math.max(AI_MIN_W, assistant.width - 24)); }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="group/rs absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize outline-none"
      >
        <span className="absolute inset-y-0 left-1 w-px bg-transparent transition-colors group-hover/rs:bg-primary/50 group-focus-visible/rs:bg-primary" />
      </div>

      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground"><Sparkles className="size-3.5" /></span>
        <span className="font-semibold tracking-tight">Ask Propniti</span>
        <span className="rounded border border-primary/25 px-1 text-[10px] font-medium tracking-wide text-primary uppercase">Beta</span>
        <div className="ml-auto flex items-center">
          <Tooltip>
            <TooltipTrigger asChild><Button asChild variant="ghost" size="icon-sm"><Link href="/app/copilot" aria-label="Open full page"><Maximize2 /></Link></Button></TooltipTrigger>
            <TooltipContent>Open as a page</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={() => assistant.setOpen(false)} aria-label="Close assistant"><X /></Button></TooltipTrigger>
            <TooltipContent>Close <span className="opacity-60">⌘J</span></TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {children ?? (
          <div className="flex h-full flex-col justify-end gap-4 p-4">
            <div className="flex flex-col gap-1">
              <div className="text-[15px] font-semibold tracking-tight">What can I help with, {data.persona.name.split(" ")[0]}?</div>
              <p className="text-muted-foreground">Ask about your data, tell me to do something, or ask how a feature works. I show every record I look up, and anything that moves money waits for your approval.</p>
            </div>
            <AskBox size="md" autoFocus onAsk={(q) => assistant.ask(q)} suggestions={data.assistantPrompts} />
          </div>
        )}
      </div>
    </aside>
  );
}
