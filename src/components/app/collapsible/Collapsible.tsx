"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShell } from "../shell/context";
import { collapsedKeys, sectionKey, setCollapsed, subscribe } from "./prefs";

// A home or dashboard section the visitor can collapse to its header line. The state is remembered
// per persona in this browser (prefs.ts). Server pages compose it from parts: <Collapsible> wraps the
// section, <CollapseButton> goes in its header, <CollapseBody> holds what hides, and
// <WhenCollapsed>/<WhenExpanded> swap header text (a short summary while collapsed).
// The section carries `group/collapse` and data-collapsed, so headers can drop their bottom border
// with `group-data-collapsed/collapse:border-b-0`.

type Ctx = { collapsed: boolean; toggle: () => void; settle: () => void; moving: boolean; bodyId: string; label: string };
const CollapseCtx = createContext<Ctx | null>(null);

function useCollapse() {
  const ctx = useContext(CollapseCtx);
  if (!ctx) throw new Error("Collapse parts must be inside <Collapsible>");
  return ctx;
}

export function Collapsible({ id, label, className, style, children, ...rest }: { id: string; label: string } & React.ComponentProps<"section">) {
  const { data } = useShell();
  const key = sectionKey(data.persona.id, id);
  // The server rendered from the pn_layout cookie; hydrate from the same list so nothing jumps.
  const server = useMemo(() => new Set(data.collapsed), [data.collapsed]);
  const collapsed = useSyncExternalStore(subscribe, collapsedKeys, () => server).has(key);
  const bodyId = useId();
  const [moving, setMoving] = useState(false);
  const toggle = useCallback(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setMoving(true);
    setCollapsed(key, !collapsed);
  }, [key, collapsed]);
  const settle = useCallback(() => setMoving(false), []);
  // transitionend can be skipped (tab hidden, nothing to animate); don't leave content clipped.
  useEffect(() => {
    if (!moving) return;
    const t = setTimeout(settle, 400);
    return () => clearTimeout(t);
  }, [moving, settle]);
  const ctx = useMemo(() => ({ collapsed, toggle, settle, moving, bodyId, label }), [collapsed, toggle, settle, moving, bodyId, label]);
  return (
    <CollapseCtx.Provider value={ctx}>
      {/* Capped at its content while collapsed, so a stretched grid cell doesn't leave an empty card. */}
      <section {...rest} data-collapsed={collapsed || undefined} className={cn("group/collapse", className)} style={collapsed ? { ...style, maxHeight: "max-content" } : style}>
        {children}
      </section>
    </CollapseCtx.Provider>
  );
}

export function CollapseButton({ className }: { className?: string }) {
  const { collapsed, toggle, bodyId, label } = useCollapse();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={!collapsed}
      aria-controls={bodyId}
      aria-label={label}
      title={collapsed ? `Expand ${label.toLowerCase()}` : `Collapse ${label.toLowerCase()}`}
      className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 sm:size-6", className)}
    >
      <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-200 ease-out motion-reduce:transition-none", collapsed && "-rotate-90")} />
    </button>
  );
}

export function CollapseBody({ className, children }: { className?: string; children: React.ReactNode }) {
  const { collapsed, moving, settle, bodyId } = useCollapse();
  return (
    <div
      id={bodyId}
      inert={collapsed}
      onTransitionEnd={(e) => { if (e.target === e.currentTarget) settle(); }}
      className={cn("grid transition-[grid-template-rows,visibility] duration-200 ease-out motion-reduce:transition-none", collapsed ? "invisible grid-rows-[0fr]" : "grid-rows-[1fr]", className)}
    >
      {/* Clip only while closed or animating, so focus rings and popovers aren't cut off when open. */}
      <div className={cn("min-h-0 min-w-0", (collapsed || moving) && "overflow-hidden")}>{children}</div>
    </div>
  );
}

export function WhenCollapsed({ children }: { children: React.ReactNode }) {
  return useCollapse().collapsed ? children : null;
}

export function WhenExpanded({ children }: { children: React.ReactNode }) {
  return useCollapse().collapsed ? null : children;
}

// The page `Section` (title, description, actions) with a collapse button and a one-line summary
// shown next to the title while collapsed.
export function CollapsibleSection({ id, title, label, description, summary, actions, className, children }: {
  id: string;
  title: React.ReactNode;
  label?: string;                         // button name when the title isn't plain text
  description?: React.ReactNode;
  summary?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Collapsible id={id} label={label ?? (typeof title === "string" ? title : id)} className={cn("scroll-mt-4", className)}>
      <div className="mb-2.5 flex items-end gap-3 group-data-collapsed/collapse:mb-0 group-data-collapsed/collapse:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="shrink-0 text-[14px] font-semibold tracking-tight">{title}</h2>
            {summary != null && <WhenCollapsed><span className="min-w-0 truncate text-[12.5px] text-muted-foreground">{summary}</span></WhenCollapsed>}
          </div>
          {description && <WhenExpanded><p className="text-[12.5px] text-muted-foreground">{description}</p></WhenExpanded>}
        </div>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        <CollapseButton />
      </div>
      <CollapseBody>{children}</CollapseBody>
    </Collapsible>
  );
}
