"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { ChevronDown, ChevronRight, ChevronsUpDown, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "../display";
import { SetupPill } from "../onboarding/SetupChecklist";
import { useShell } from "./context";
import { AppMark } from "./AppMark";
import type { ShellNavItem, ShellNavSection } from "./types";

// Longest nav href that prefixes the path is the active item ("/app" only matches exactly).
export function activeHref(pathname: string, sections: ShellNavSection[]) {
  let best = "";
  for (const s of sections) for (const i of s.items) {
    if (pathname === i.href || (i.href !== "/app" && pathname.startsWith(i.href + "/"))) if (i.href.length > best.length) best = i.href;
  }
  return best;
}

type Entry = { kind: "item"; item: ShellNavItem } | { kind: "group"; label: string; items: ShellNavItem[] };
function entries(items: ShellNavItem[]): Entry[] {
  const out: Entry[] = [];
  for (const item of items) {
    if (!item.group) { out.push({ kind: "item", item }); continue; }
    const g = out.find((e): e is Extract<Entry, { kind: "group" }> => e.kind === "group" && e.label === item.group);
    if (g) g.items.push(item); else out.push({ kind: "group", label: item.group, items: [item] });
  }
  return out;
}

export function Sidebar({ collapsed, onToggle, className, onNavigate }: { collapsed: boolean; onToggle?: () => void; className?: string; onNavigate?: () => void }) {
  const { data, openPalette, openSetup } = useShell();
  const pathname = usePathname();
  const active = activeHref(pathname, data.nav);
  const [closed, setClosed] = useLocalStorage<string[]>("pn_nav_closed", []);
  const toggleSection = (key: string) => setClosed((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));

  return (
    <nav data-tour="sidebar" aria-label="Main" className={cn("flex h-full flex-col bg-sidebar text-sidebar-foreground", className)}>
      <div className={cn("flex h-12 shrink-0 items-center gap-1 border-b border-sidebar-border/70", collapsed ? "justify-center px-2" : "px-2.5")}>
        <WorkspaceMenu collapsed={collapsed} />
      </div>

      <div className={cn("shrink-0 pt-2.5 pb-1", collapsed ? "px-2" : "px-2.5")}>
        {collapsed ? (
          <RailTip label="Search" kbd="⌘K">
            <button onClick={() => openPalette()} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" aria-label="Search"><Search className="size-4" /></button>
          </RailTip>
        ) : (
          <button onClick={() => openPalette()} className="flex h-8 w-full items-center gap-2 rounded-md border border-sidebar-border bg-background px-2 text-muted-foreground shadow-xs transition-colors hover:border-input hover:text-foreground">
            <Search className="size-3.5" />
            <span className="flex-1 text-left">Search or jump to…</span>
            <Kbd>⌘K</Kbd>
          </button>
        )}
      </div>

      <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 [scrollbar-width:thin]", collapsed ? "px-2" : "px-2.5")}>
        {data.nav.map((section) => {
          const isClosed = closed.includes(section.section);
          return (
            <div key={section.section} className="mt-3 first:mt-1.5">
              {collapsed ? (
                <div className="mx-auto mb-1 h-px w-5 bg-sidebar-border first:hidden" />
              ) : section.section !== "home" && (
                <button onClick={() => toggleSection(section.section)} className="group/sec mb-0.5 flex h-6 w-full items-center gap-1 rounded px-2 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase hover:text-foreground">
                  {section.label}
                  <ChevronDown className={cn("size-3 opacity-0 transition-transform group-hover/sec:opacity-100", isClosed && "-rotate-90 opacity-100")} />
                </button>
              )}
              {!(isClosed && !collapsed) && (
                <ul className="space-y-px">
                  {entries(section.items).map((e) => e.kind === "item"
                    ? <li key={e.item.key}><NavLink item={e.item} active={active === e.item.href} collapsed={collapsed} onNavigate={onNavigate} /></li>
                    : collapsed
                      ? e.items.map((i) => <li key={i.key}><NavLink item={i} active={active === i.href} collapsed onNavigate={onNavigate} /></li>)
                      : <NavGroup key={e.label} label={e.label} items={e.items} active={active} onNavigate={onNavigate} />)}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className={cn("shrink-0 space-y-1 border-t border-sidebar-border/70 py-2", collapsed ? "px-2" : "px-2.5")}>
        <SetupPill collapsed={collapsed} onClick={openSetup} />
        {onToggle && (
          <RailTip label={collapsed ? "Expand sidebar" : "Collapse sidebar"} kbd="⌘B" show={collapsed}>
            <button onClick={onToggle} className={cn("flex h-7 items-center gap-2 rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground", collapsed ? "w-8 justify-center" : "w-full px-2")} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /><span className="flex-1 text-left text-[12px]">Collapse</span><Kbd>⌘B</Kbd></>}
            </button>
          </RailTip>
        )}
      </div>
    </nav>
  );
}

function NavLink({ item, active, collapsed, nested, onNavigate }: { item: ShellNavItem; active: boolean; collapsed?: boolean; nested?: boolean; onNavigate?: () => void }) {
  const count = item.count ? (item.count > 999 ? "999+" : String(item.count)) : null;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/nav relative flex items-center gap-2 rounded-md text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        collapsed ? "size-8 justify-center" : "h-7 px-2",
        nested && "h-[26px] pl-2",
        active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_var(--sidebar-border)]" : "text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
      )}
    >
      {!nested && <span className={cn("shrink-0 [&_svg]:size-4", active ? "text-primary" : "text-muted-foreground group-hover/nav:text-foreground")}>{item.icon}</span>}
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {count && !collapsed && (
        <span className={cn("ml-auto rounded px-1.5 text-[11px] leading-[18px] font-medium tabular-nums", item.countTone === "attention" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{count}</span>
      )}
      {count && collapsed && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />}
    </Link>
  );
  return collapsed ? <RailTip label={item.label} extra={count ?? undefined}>{link}</RailTip> : link;
}

function NavGroup({ label, items, active, onNavigate }: { label: string; items: ShellNavItem[]; active: string; onNavigate?: () => void }) {
  const hasActive = items.some((i) => i.href === active);
  const [openGroups, setOpenGroups] = useLocalStorage<string[]>("pn_nav_groups", []);
  const open = hasActive || openGroups.includes(label);
  const total = items.reduce((a, i) => a + (i.count ?? 0), 0);
  return (
    <li>
      <button
        onClick={() => setOpenGroups((g) => (g.includes(label) ? g.filter((x) => x !== label) : [...g, label]))}
        aria-expanded={open}
        className={cn("group/nav flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground", hasActive && "text-sidebar-accent-foreground")}
      >
        <span className={cn("shrink-0 [&_svg]:size-4", hasActive ? "text-primary" : "text-muted-foreground group-hover/nav:text-foreground")}>{items[0]!.icon}</span>
        <span className="flex-1 truncate text-left">{label}</span>
        {!open && total > 0 && <span className="text-[11px] text-muted-foreground tabular-nums">{total}</span>}
        <ChevronRight className={cn("size-3.5 text-muted-foreground/70 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <ul className="relative mt-px ml-[15px] space-y-px border-l border-sidebar-border pl-2">
          {items.map((i) => <li key={i.key}><NavLink item={i} active={active === i.href} nested onNavigate={onNavigate} /></li>)}
        </ul>
      )}
    </li>
  );
}

function RailTip({ label, kbd, extra, children, show = true }: { label: string; kbd?: string; extra?: string; children: React.ReactElement; show?: boolean }) {
  if (!show) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">{label}{extra && <span className="opacity-70">{extra}</span>}{kbd && <span className="opacity-60">{kbd}</span>}</TooltipContent>
    </Tooltip>
  );
}

function WorkspaceMenu({ collapsed }: { collapsed: boolean }) {
  const { data } = useShell();
  const p = data.persona;
  const scopes = useMemo(() => [...new Set(data.personas.filter((x) => !x.portal).map((x) => x.scopeLabel))].slice(0, 6), [data.personas]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn("flex min-w-0 items-center gap-2 rounded-md text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60", collapsed ? "size-8 justify-center" : "h-9 w-full px-1.5")} aria-label="Workspace">
          <AppMark size={22} />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px] font-semibold tracking-tight">Propniti</span>
                <span className="block truncate text-[11px] text-muted-foreground">{p.scopeLabel}</span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Workspace</DropdownMenuLabel>
        <DropdownMenuItem className="gap-2"><AppMark size={18} /><span className="flex-1">Propniti demo portfolio</span><span className="text-[11px] text-muted-foreground">30 properties</span></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Your scope as {p.title.toLowerCase()}</DropdownMenuLabel>
        <DropdownMenuItem disabled className="opacity-100"><span className="size-1.5 rounded-full bg-primary" />{p.scopeLabel}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Other scopes (switch role to see them)</DropdownMenuLabel>
        {scopes.filter((s) => s !== p.scopeLabel).map((s) => <DropdownMenuItem key={s} disabled className="text-muted-foreground">{s}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
