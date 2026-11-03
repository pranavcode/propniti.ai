"use client";

import { useRef, useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// The large "Ask or tell Propniti…" prompt (home briefing, assistant dock, empty states).
// Enter submits, Shift+Enter adds a line. Suggested questions submit on click.
export function AskBox({ onAsk, suggestions = [], placeholder = "Ask or tell Propniti anything about your portfolio…", size = "lg", autoFocus, busy, className, footer }: {
  onAsk: (q: string) => void;
  suggestions?: string[];
  placeholder?: string;
  size?: "md" | "lg";
  autoFocus?: boolean;
  busy?: boolean;
  className?: string;
  footer?: React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const submit = (text = q) => {
    const t = text.trim();
    if (!t || busy) return;
    onAsk(t);
    setQ("");
  };
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div
        onClick={() => ref.current?.focus()}
        className={cn(
          "group/ask relative rounded-xl border bg-card shadow-[0_1px_2px_oklch(0_0_0/0.04),0_8px_24px_-12px_oklch(0.47_0.085_195/0.25)] transition-[border-color,box-shadow] focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_14%,transparent),0_8px_24px_-12px_oklch(0.47_0.085_195/0.3)]",
          size === "lg" ? "p-3" : "p-2",
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className={cn("mt-0.5 flex shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary", size === "lg" ? "size-7" : "size-6")}><Sparkles className="size-3.5" /></span>
          <textarea
            name="ask"
            autoComplete="off"
            ref={ref}
            value={q}
            autoFocus={autoFocus}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            rows={size === "lg" ? 2 : 1}
            placeholder={placeholder}
            aria-label="Ask Propniti"
            className={cn("min-h-0 flex-1 resize-none bg-transparent leading-relaxed outline-none placeholder:text-muted-foreground/80", size === "lg" ? "pt-1 text-[15px]" : "pt-0.5 text-[13px]")}
          />
          <button
            onClick={(e) => { e.stopPropagation(); submit(); }}
            disabled={!q.trim() || busy}
            aria-label="Send"
            className="flex size-7 shrink-0 items-center justify-center self-end rounded-md bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
        {footer && <div className="mt-2 flex items-center gap-2 border-t pt-2 text-[11.5px] text-muted-foreground">{footer}</div>}
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} onClick={() => submit(s)} className="rounded-full border bg-background px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
