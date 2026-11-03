"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useMemo } from "react";
import { BookOpen, Check, ChevronRight, CircleHelp, Compass, Keyboard, ListChecks, LogOut, Menu, Monitor, Moon, Rows3, Search, Sparkles, Sun, UserRoundCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd, PersonAvatar } from "../display";
import { humanize } from "../status";
import { useShell } from "./context";
import { NotificationsMenu } from "./Notifications";
import { activeHref } from "./Sidebar";
import { exitPersona, switchPersona } from "./persona";
import type { ShellNavSection } from "./types";

type Crumb = { label: string; href?: string };

export function useCrumbs(): Crumb[] {
  const pathname = usePathname();
  const { data, crumbTitle } = useShell();
  return useMemo(() => crumbsFor(pathname, data.nav, crumbTitle), [pathname, data.nav, crumbTitle]);
}

export function crumbsFor(pathname: string, nav: ShellNavSection[], title: string | null): Crumb[] {
  const href = activeHref(pathname, nav);
  const section = nav.find((s) => s.items.some((i) => i.href === href));
  const item = section?.items.find((i) => i.href === href);
  if (!section || !item) {
    const segs = pathname.replace(/^\/app\/?/, "").split("/").filter(Boolean);
    return [{ label: "Home", href: "/app" }, ...segs.map((s, i) => ({ label: i === segs.length - 1 && title ? title : humanize(decodeURIComponent(s).replace(/^%5F|^_/, "")), href: i < segs.length - 1 ? "/app/" + segs.slice(0, i + 1).join("/") : undefined }))];
  }
  const out: Crumb[] = [{ label: section.label }];
  if (item.group) out.push({ label: item.group });
  const rest = pathname.slice(href.length).split("/").filter(Boolean);
  out.push({ label: item.label, href: rest.length ? item.href : undefined });
  rest.forEach((seg, i) => out.push({ label: i === rest.length - 1 && title ? title : humanize(decodeURIComponent(seg)) }));
  return out;
}

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const crumbs = useCrumbs();
  const { openPalette, assistant } = useShell();
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-4">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu /></Button>

      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 text-[13px]">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />}
            {c.href && i < crumbs.length - 1
              ? <Link href={c.href} className="truncate text-muted-foreground hover:text-foreground">{c.label}</Link>
              : <span className={cn("truncate", i === crumbs.length - 1 ? "font-medium text-foreground" : "text-muted-foreground", i < crumbs.length - 2 && "hidden md:inline")}>{c.label}</span>}
          </Fragment>
        ))}
      </nav>

      <button data-tour="search" onClick={() => openPalette()} className="hidden h-8 w-56 items-center gap-2 rounded-md border bg-muted/40 px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex xl:w-72">
        <Search className="size-3.5" />
        <span className="flex-1 truncate text-left">Search properties, residents, WOs…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => openPalette()} aria-label="Search"><Search /></Button>

      <button
        data-tour="ask"
        onClick={assistant.toggle}
        aria-pressed={assistant.open}
        className={cn(
          "group/ask relative inline-flex h-8 items-center gap-2 overflow-hidden rounded-md pr-2 pl-2.5 text-[13px] font-medium transition-[background-color,box-shadow,transform] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 active:translate-y-px motion-reduce:active:translate-y-0",
          assistant.open && "ring-2 ring-primary/30 ring-offset-1 ring-offset-background",
        )}
      >
        <Sparkles className="size-4 transition-transform group-hover/ask:rotate-12 motion-reduce:transition-none" />
        <span className="hidden sm:inline">Ask Propniti</span>
        <kbd className="hidden h-[18px] items-center rounded-[4px] bg-white/15 px-1 font-sans text-[10.5px] font-medium sm:inline-flex">⌘J</kbd>
      </button>

      <div className="flex items-center gap-0.5">
        <NotificationsMenu />
        <HelpMenu />
        <ThemeToggle />
        <ProfileMenu />
      </div>
    </header>
  );
}

function HelpMenu() {
  const { openShortcuts, startTour, openSetup } = useShell();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Help"><CircleHelp /></Button></DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Help</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
        <DropdownMenuItem asChild><Link href="/docs"><BookOpen /> Help center and docs</Link></DropdownMenuItem>
        <DropdownMenuItem onSelect={openShortcuts}><Keyboard /> Keyboard shortcuts <Kbd className="ml-auto">?</Kbd></DropdownMenuItem>
        <DropdownMenuItem onSelect={() => startTour()}><Compass /> Restart product tour</DropdownMenuItem>
        <DropdownMenuItem onSelect={openSetup}><ListChecks /> Setup checklist</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useShell();
  const Icon = theme === "dark" ? Moon : theme === "system" ? Monitor : Sun;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Theme"><Icon /></Button></DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Theme</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
        {([["light", Sun, "Light"], ["dark", Moon, "Dark"], ["system", Monitor, "System"]] as const).map(([t, I, label]) => (
          <DropdownMenuItem key={t} onSelect={() => setTheme(t)}><I /> {label}{theme === t && <Check className="ml-auto" />}</DropdownMenuItem>
        ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProfileMenu() {
  const { data, density, setDensity } = useShell();
  const me = data.persona;
  const staff = data.personas.filter((p) => !p.portal);
  const portals = data.personas.filter((p) => p.portal);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button data-tour="profile" className="ml-1 flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label="Profile and role">
          <PersonAvatar name={me.name} size={26} className="ring-2 ring-background" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <PersonAvatar name={me.name} size={32} />
          <div className="min-w-0 leading-tight">
            <div className="truncate font-medium">{me.name}</div>
            <div className="truncate text-[12px] text-muted-foreground">{me.title} · {me.scopeLabel}</div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><UserRoundCog /> Switch role (demo)</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[70vh] w-80 overflow-y-auto">
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Staff</DropdownMenuLabel>
            <DropdownMenuGroup>
              {staff.map((p) => <PersonaItem key={p.id} p={p} current={p.id === me.id} />)}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Portals</DropdownMenuLabel>
            <DropdownMenuGroup>
              {portals.map((p) => <PersonaItem key={p.id} p={p} current={p.id === me.id} />)}
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setDensity(density === "compact" ? "comfortable" : "compact"); }}>
          <Rows3 /> Compact tables {density === "compact" && <Check className="ml-auto" />}
        </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup><DropdownMenuItem onSelect={exitPersona}><LogOut /> Sign out of demo</DropdownMenuItem></DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PersonaItem({ p, current }: { p: { id: string; name: string; title: string; scopeLabel: string; home: string }; current: boolean }) {
  return (
    <DropdownMenuItem onSelect={() => !current && switchPersona(p.id, p.home)} className="items-start gap-2.5 py-1.5">
      <PersonAvatar name={p.name} size={24} className="mt-0.5" />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate font-medium">{p.name}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{p.title} · {p.scopeLabel}</span>
      </span>
      {current && <Check className="mt-1 text-primary" />}
    </DropdownMenuItem>
  );
}
