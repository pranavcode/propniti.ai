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

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

// A label with a definition: dotted underline and a small ⓘ. Hover or keyboard focus previews the
// definition; a click, tap, Enter or Space pins it open as a non-modal popover that Tab moves into
// (for "Learn more"); Escape closes it and returns focus. Labels with no definition render as plain text.
export function Term({ children, term, help, iconOnly, className }: TermProps) {
  const label = term ?? (typeof children === "string" ? children : undefined);
  const h = helpFor(label, help);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const quiet = useRef(false); // focus returned by Escape shouldn't reopen the preview
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!h) return <>{children}</>;
  const name = label ?? "this term";
  const show = (delay = 0) => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), delay); };
  const close = () => { clearTimeout(timer.current); setOpen(false); setPinned(false); };
  const hide = (delay = 0) => { clearTimeout(timer.current); timer.current = setTimeout(close, delay); };
  const inside = (el: EventTarget | null) => !!el && (content.current?.contains(el as Node) || el === trigger.current);
  const returnFocus = () => { quiet.current = true; trigger.current?.focus(); quiet.current = false; };
  // Leaving the popover forward continues to whatever follows the label on the page.
  const focusAfterTrigger = () => {
    const all = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => !content.current?.contains(el));
    const next = all[all.indexOf(trigger.current!) + 1];
    close();
    (next ?? trigger.current)?.focus();
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={trigger}
          type="button"
          aria-label={iconOnly ? `What ${name} means` : undefined}
          aria-describedby={`${id}-d`}
          aria-expanded={pinned}
          data-term={name}
          onPointerEnter={(e) => { if (e.pointerType === "mouse") show(150); }}
          onPointerLeave={(e) => { if (e.pointerType === "mouse" && !pinned) hide(120); }}
          onFocus={() => { if (!quiet.current) show(); }}
          onBlur={(e) => { if (!inside(e.relatedTarget)) hide(120); }}
          onClick={(e) => {
            e.preventDefault(); e.stopPropagation();
            if (pinned) close(); else { clearTimeout(timer.current); setOpen(true); setPinned(true); }
          }}
          onKeyDown={(e) => {
            const first = content.current?.querySelector<HTMLElement>(TABBABLE);
            if (e.key === "Tab" && !e.shiftKey && open && first) { e.preventDefault(); setPinned(true); first.focus(); }
          }}
          className={cn("inline-flex max-w-full min-w-0 cursor-help items-center gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60", className)}
        >
          {!iconOnly && <span className="truncate underline decoration-muted-foreground/45 decoration-dotted underline-offset-[3px]">{children}</span>}
          <Info aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
        </button>
      </PopoverPrimitive.Trigger>
      <span id={`${id}-d`} hidden>{h.summary}</span>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={content}
          aria-label={name}
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => { e.preventDefault(); const back = inside(document.activeElement); close(); if (back) returnFocus(); }}
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={(e) => { if (e.pointerType === "mouse" && !pinned) hide(120); }}
          onBlur={(e) => { if (!inside(e.relatedTarget)) hide(120); }}
          onKeyDown={(e) => {
            if (e.key !== "Tab") return;
            const items = [...(content.current?.querySelectorAll<HTMLElement>(TABBABLE) ?? [])];
            if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); returnFocus(); }
            else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); focusAfterTrigger(); }
          }}
          className="z-50 w-max max-w-72 rounded-md border bg-popover px-3 py-2 text-[12px] leading-relaxed font-normal text-popover-foreground normal-case tracking-normal shadow-md outline-none data-open:animate-in data-open:fade-in-0"
        >
          <p className="font-semibold">{name}</p>
          <p className="mt-0.5 text-muted-foreground">{h.summary}</p>
          {h.article && (
            <Link href={helpHref(h.article)} className="mt-1.5 inline-flex items-center gap-1 rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">
              Learn more <ArrowRight aria-hidden className="size-3" />
            </Link>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
