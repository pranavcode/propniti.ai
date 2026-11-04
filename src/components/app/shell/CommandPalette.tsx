"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock, Compass, CornerDownLeft, Keyboard, Loader2, Monitor, Moon, Plus, Rows3, Sparkles, Sun, Zap } from "lucide-react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Kbd } from "../display";
import { useRecent } from "../recent";
import { useShell } from "./context";
import type { ShellSearchEntity } from "./types";

type Hit = { entity: ShellSearchEntity; id: string; title: string; sub?: string };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
const hit = (q: string, ...hay: (string | undefined)[]) => { const n = norm(q); return hay.some((h) => h && norm(h).includes(n)); };
const QUESTION = /^(who|what|which|when|where|why|how|show|list|find|is|are|did|does|can|draft|send|compare|rank)\b|\?$/i;

// ⌘K: navigate, recent records, live record search, create, quick actions, "Ask AI", preferences.
export function CommandPalette({ open, onOpenChange, initialQuery = "" }: { open: boolean; onOpenChange: (o: boolean) => void; initialQuery?: string }) {
  const router = useRouter();
  const { data, assistant, setTheme, density, setDensity, openShortcuts, startTour } = useShell();
  const recent = useRecent();
  const [q, setQ] = useState(initialQuery);
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) { setPrevOpen(open); if (open) { setQ(initialQuery); setHits([]); } }

  // Record search through the generic list API: q= on the first few searchable entities.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      const results = await Promise.all(data.searchEntities.slice(0, 6).map(async (e) => {
        try {
          const r = await fetch(`/api/e/${e.key}?q=${encodeURIComponent(term)}&size=4`, { signal: ctl.signal });
          if (!r.ok) return [];
          const body = (await r.json()) as { rows: Record<string, unknown>[] };
          return body.rows.map((row) => ({ entity: e, id: String(row.id), title: String(row[e.titleField] ?? row.id), sub: e.one }));
        } catch { return []; }
      }));
      if (!ctl.signal.aborted) { setHits(results.flat()); setSearching(false); }
    }, 180);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, data.searchEntities]);

  const go = (href: string) => { onOpenChange(false); router.push(href); };
  const run = (fn: () => void) => { onOpenChange(false); fn(); };
  const term = q.trim();
  const shownHits = term.length >= 2 ? hits : [];

  const nav = useMemo(() => data.nav.flatMap((s) => s.items.map((i) => ({ ...i, path: [s.label, i.group].filter(Boolean).join(" / ") }))), [data.nav]);
  const navHits = term ? nav.filter((i) => hit(term, i.label, i.group, i.path)) : nav.slice(0, 8);
  const createHits = term ? data.createActions.filter((a) => hit(term, a.label, "new create add")) : data.createActions.slice(0, 4);
  const quickHits = term ? data.quickActions.filter((a) => hit(term, a.label)) : data.quickActions;
  const recentHits = term ? recent.filter((r) => hit(term, r.title, r.subtitle)).slice(0, 5) : recent.slice(0, 5);
  const prefs = [
    { key: "light", label: "Switch to light theme", icon: <Sun />, fn: () => setTheme("light") },
    { key: "dark", label: "Switch to dark theme", icon: <Moon />, fn: () => setTheme("dark") },
    { key: "system", label: "Use system theme", icon: <Monitor />, fn: () => setTheme("system") },
    { key: "density", label: density === "compact" ? "Comfortable table rows" : "Compact table rows", icon: <Rows3 />, fn: () => setDensity(density === "compact" ? "comfortable" : "compact") },
    { key: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard />, fn: openShortcuts, kbd: "?" },
    { key: "tour", label: "Restart product tour", icon: <Compass />, fn: () => startTour() },
  ];
  const prefHits = term ? prefs.filter((p) => hit(term, p.label, "theme dark light density compact keyboard shortcuts tour help")) : [];
  const askFirst = QUESTION.test(term);

  const ask = term.length > 2 && (
    <CommandGroup heading="Ask Propniti">
      <CommandItem value="ask-ai" onSelect={() => run(() => assistant.ask(term))} className="gap-2.5">
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary"><Sparkles className="size-3.5" /></span>
        <span className="min-w-0 flex-1 truncate"><span className="text-muted-foreground">Ask AI: </span>{term}</span>
        <Kbd><CornerDownLeft className="size-2.5" /></Kbd>
      </CommandItem>
    </CommandGroup>
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="max-w-[640px] sm:max-w-[640px]" title="Search and commands" description="Jump to a page or record, run a command, or ask the AI">
      <Command shouldFilter={false} loop className="[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-item]]:h-9 [&_[cmdk-item]]:text-[13px]">
        <CommandInput value={q} onValueChange={setQ} placeholder="Search records, jump to a page, or ask a question…" />
        <CommandList className="max-h-[min(460px,60vh)]">
          {askFirst && ask}
          {recentHits.length > 0 && (
            <CommandGroup heading="Recent">
              {recentHits.map((r) => (
                <CommandItem key={r.href} value={`recent-${r.href}`} onSelect={() => go(r.href)}>
                  <Clock className="text-muted-foreground" />
                  <span className="truncate">{r.title}</span>
                  {r.subtitle && <span className="truncate text-muted-foreground">{r.subtitle}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {(shownHits.length > 0 || (searching && term.length >= 2)) && (
            <CommandGroup heading="Records">
              {shownHits.map((h) => (
                <CommandItem key={`${h.entity.key}-${h.id}`} value={`rec-${h.entity.key}-${h.id}`} onSelect={() => go(`${h.entity.route}/${encodeURIComponent(h.id)}`)}>
                  <span className="text-muted-foreground">{h.entity.icon}</span>
                  <span className="truncate">{h.title}</span>
                  <span className="ml-auto text-[11.5px] text-muted-foreground">{h.sub}</span>
                </CommandItem>
              ))}
              {searching && shownHits.length === 0 && <div className="flex items-center gap-2 px-2 py-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Searching…</div>}
            </CommandGroup>
          )}
          {quickHits.length > 0 && (
            <CommandGroup heading="Quick actions">
              {quickHits.map((a) => (
                <CommandItem key={a.key} value={a.key} onSelect={() => go(a.href)}><Zap className="text-muted-foreground" />{a.label}<ArrowRight className="ml-auto opacity-0 group-data-[selected=true]/command-item:opacity-60" /></CommandItem>
              ))}
            </CommandGroup>
          )}
          {navHits.length > 0 && (
            <CommandGroup heading="Go to">
              {navHits.map((i) => (
                <CommandItem key={i.key} value={`nav-${i.key}`} onSelect={() => go(i.href)}>
                  <span className="text-muted-foreground">{i.icon}</span>
                  <span>{i.label}</span>
                  <span className="ml-auto text-[11.5px] text-muted-foreground">{i.path}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {createHits.length > 0 && (
            <CommandGroup heading="Create">
              {createHits.map((a) => (
                <CommandItem key={a.key} value={a.key} onSelect={() => go(a.href)}><Plus className="text-muted-foreground" />{a.label}</CommandItem>
              ))}
            </CommandGroup>
          )}
          {prefHits.length > 0 && (
            <CommandGroup heading="Preferences">
              {prefHits.map((p) => (
                <CommandItem key={p.key} value={`pref-${p.key}`} onSelect={() => run(p.fn)}><span className="text-muted-foreground [&_svg]:size-4">{p.icon}</span>{p.label}{p.kbd && <Kbd className="ml-auto">{p.kbd}</Kbd>}</CommandItem>
              ))}
            </CommandGroup>
          )}
          {!askFirst && ask && <><CommandSeparator />{ask}</>}
          <CommandEmpty>No matches. Press Enter to ask the AI instead.</CommandEmpty>
        </CommandList>
        <div className="flex h-9 items-center gap-3 border-t px-3 text-[11.5px] text-muted-foreground">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
          <span className="flex items-center gap-1"><Kbd>esc</Kbd> close</span>
          <span className="ml-auto flex items-center gap-1"><Sparkles className="size-3 text-primary" /> Type a question to ask the AI</span>
        </div>
      </Command>
    </CommandDialog>
  );
}
