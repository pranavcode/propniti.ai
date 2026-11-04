"use client";

import Link from "@/components/Link";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Info } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { helpFor, helpHref, type Help } from "@/lib/glossary";

type TermProps = {
  children?: React.ReactNode;
  term?: string;               // glossary key when children isn't the plain label
  help?: Help | string | null; // a field or KPI's own help; wins over the glossary
  iconOnly?: boolean;          // just the ⓘ, beside a label that is itself a button (sortable headers)
  className?: string;
};

// A label with a definition: dotted underline and a small ⓘ. The definition opens on hover and on
// keyboard focus, and a tap opens it on touch screens. Labels with no definition render as plain text.
export function Term({ children, term, help, iconOnly, className }: TermProps) {
  const label = term ?? (typeof children === "string" ? children : undefined);
  const h = helpFor(label, help);
  const [open, setOpen] = useState(false);
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openedAt = useRef(0);
  const pointer = useRef("mouse");
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!h) return <>{children}</>;
  const show = (delay = 0) => { clearTimeout(timer.current); timer.current = setTimeout(() => { openedAt.current = performance.now(); setOpen(true); }, delay); };
  const hide = (delay = 0) => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), delay); };
  const name = label ?? "this term";

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={iconOnly ? `What ${name} means` : undefined}
          aria-describedby={open ? id : undefined}
          data-term={name}
          onPointerDown={(e) => { pointer.current = e.pointerType; }}
          onPointerEnter={(e) => { if (e.pointerType === "mouse") show(150); }}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") hide(120); }}
          onFocus={() => show()}
          onBlur={(e) => { if (!content.current?.contains(e.relatedTarget)) hide(120); }}
          // Hover already opened it for a mouse; a tap (or Enter) toggles, unless focus just opened it.
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (pointer.current !== "mouse" && performance.now() - openedAt.current > 400) setOpen((o) => !o); pointer.current = "mouse"; }}
          className={cn("inline-flex max-w-full min-w-0 cursor-help items-center gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60", className)}
        >
          {!iconOnly && <span className="truncate underline decoration-muted-foreground/45 decoration-dotted underline-offset-[3px]">{children}</span>}
          <Info aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={content}
          id={id}
          role="tooltip"
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") hide(120); }}
          className="z-50 w-max max-w-72 rounded-md border bg-popover px-3 py-2 text-[12px] leading-relaxed font-normal text-popover-foreground normal-case tracking-normal shadow-md outline-none data-open:animate-in data-open:fade-in-0"
        >
          <p className="font-semibold">{name}</p>
          <p className="mt-0.5 text-muted-foreground">{h.summary}</p>
          {h.article && (
            <Link href={helpHref(h.article)} className="mt-1.5 inline-flex items-center gap-1 font-medium text-primary hover:underline">
              Learn more <ArrowRight aria-hidden className="size-3" />
            </Link>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
