"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Compass, Ellipsis, Lightbulb, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { readLocal, useLocalStorage } from "@/hooks/use-local-storage";
import { useShell } from "../shell/context";
import { localTourStore } from "../tour/TourEngine";
import type { TourDef } from "../tour/types";
import { splashDue } from "../welcome/rules";
import { blockedBy, dismissNudge, EXPLAIN_SELECTOR, PEEK_ROW_SELECTOR, pickNudge, recordShown, type GuideFacts, type GuidePrefs, type GuideSession, type Nudge, type TourState } from "./nudges";

// The "Ask Propniti" chat bubble, bottom right on every staff page. It toggles the same assistant
// panel as ⌘J and, now and then, shows one small nudge computed from the persona's real counts
// (see nudges.ts for the rules and the restraint).

const PREFS = "pn_guide";
const SESSION = "pn_guide_session";
const FACTS = "pn_guide_facts";
const FACTS_TTL_MS = 2 * 60_000;
const FIRST_LOOK_MS = 3500;          // let the page settle before a nudge
const RETRY_MS = 5000;
const AUTO_HIDE_MS = 30_000;
// Things the bubble must not cover: it lifts above them when they reach its corner.
const AVOID = '[aria-label="Next page"], [aria-label="Previous page"], [role="toolbar"][aria-label="Bulk actions"]';
const NO_PREFS: GuidePrefs = {};

function readSession(): GuideSession {
  try { return JSON.parse(sessionStorage.getItem(SESSION) ?? "") as GuideSession; } catch { return { shown: [] }; }
}
function writeSession(s: GuideSession) {
  try { sessionStorage.setItem(SESSION, JSON.stringify(s)); } catch { /* unavailable */ }
}

// One small request, reused for two minutes across page views (and shared by concurrent callers).
// A failed request is remembered for the same two minutes, so a struggling server isn't asked again.
let inflight: Promise<GuideFacts | null> | null = null;
export function loadFacts(persona: string): Promise<GuideFacts | null> {
  try {
    const c = JSON.parse(sessionStorage.getItem(FACTS) ?? "null") as { persona: string; at: number; facts: GuideFacts | null } | null;
    if (c && c.persona === persona && Date.now() - c.at < FACTS_TTL_MS) return Promise.resolve(c.facts);
  } catch { /* fall through to the network */ }
  inflight ??= fetch("/api/guide", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<GuideFacts>) : null))
    .catch(() => null)
    .then((facts) => {
      try { sessionStorage.setItem(FACTS, JSON.stringify({ persona, at: Date.now(), facts })); } catch { /* unavailable */ }
      return facts;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
const toastShowing = () => !!document.querySelector("[data-feature-toast]");
const typing = () => !!document.activeElement?.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"], [contenteditable=""]');

function tourStates(tours: TourDef[]): TourState[] {
  return tours.map((t) => {
    const p = localTourStore.get(t.id);
    return { id: t.id, title: t.title, steps: t.steps.length, paths: t.steps.flatMap((s) => (s.href ? [s.href.split("?")[0]] : [])), status: p?.status ?? null, step: p?.step ?? 0 };
  });
}

export function ChatBubble() {
  const { data, assistant, startTour, tourActive } = useShell();
  const router = useRouter();
  const pathname = usePathname();
  const [prefs, setPrefs] = useLocalStorage<GuidePrefs>(PREFS, NO_PREFS);
  // The nudge belongs to the page view it was picked for; navigating away drops it.
  const [shown, setShown] = useState<{ path: string; nudge: Nudge } | null>(null);
  const nudge = shown?.path === pathname ? shown.nudge : null;
  const [overlay, setOverlay] = useState(false);
  const [lift, setLift] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const live = useRef({ tourActive, open: assistant.open });
  useEffect(() => { live.current = { tourActive, open: assistant.open }; }, [tourActive, assistant.open]);

  const hiddenPage = !showsBubble(pathname);
  // Read inside the nudge effect; a router.refresh() hands over new nav and tour objects, which
  // must not count as a new page view.
  const shell = useRef({ nav: data.nav, tours: data.tours });
  useEffect(() => { shell.current = { nav: data.nav, tours: data.tours }; }, [data.nav, data.tours]);

  // Hide while a dialog or drawer is open (Radix portals mount and unmount as body children).
  useEffect(() => {
    const check = () => setOverlay(dialogOpen());
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true });
    return () => mo.disconnect();
  }, []);

  // Lift above pagination and the bulk-action bar when they reach the bubble's corner.
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const b = bubbleRef.current?.getBoundingClientRect();
      if (!b) return;
      const vh = window.innerHeight;
      const top = vh - 16 - b.height - 8;
      let need = 0;
      for (const el of document.querySelectorAll<HTMLElement>(AVOID)) {
        const r = el.getBoundingClientRect();
        if (!r.width || r.right < b.left - 8 || r.left > b.right + 8 || r.bottom < top || r.top > vh) continue;
        need = Math.max(need, vh - r.top + 8 - 16);
      }
      setLift(Math.min(need, vh / 2));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    const main = document.getElementById("main");
    // Capture: any scroller (main, or the document on phones) moves the pager.
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    // Lists render their pager after data loads; one check per frame at most.
    const mo = new MutationObserver(schedule);
    if (main) mo.observe(main, { childList: true, subtree: true });
    schedule();
    return () => {
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pathname, assistant.open, assistant.width]);

  // Remember that Explain was used, so its tip stops.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.(EXPLAIN_SELECTOR) && !readLocal<GuidePrefs>(PREFS, NO_PREFS).explained) {
        setPrefs((p) => ({ ...p, explained: true }));
        setShown((s) => (s?.nudge.id === "tip.explain" ? null : s));
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [setPrefs]);

  // One look per page view: after the page settles, if the rules allow a nudge, pick one.
  const { id: personaId, home } = data.persona;
  useEffect(() => {
    // The welcome splash already lists what's waiting; no nudge on the page view it opens on.
    if (hiddenPage || splashDue(pathname, { id: personaId, home })) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    const attempt = async () => {
      const session = readSession();
      const p = readLocal<GuidePrefs>(PREFS, NO_PREFS);
      const { nav, tours } = shell.current;
      const why = blockedBy({
        now: Date.now(), prefs: p, session, shownThisView: false,
        tourActive: live.current.tourActive,
        typing: typing(), overlay: dialogOpen() || live.current.open || toastShowing(),
      });
      const retry = () => { if (++tries < 6) timer = setTimeout(attempt, RETRY_MS); };
      if (why === "typing" || why === "overlay" || why === "tour") return retry();
      if (why) return;
      const facts = await loadFacts(personaId);
      if (cancelled) return;
      if (typing() || dialogOpen() || live.current.open || live.current.tourActive || toastShowing()) return retry();
      const n = pickNudge({
        path: pathname, search: window.location.search, day: new Date().toLocaleDateString("en-CA"), nav: nav.flatMap((s) => s.items.map((i) => i.href)), facts, tours: tourStates(tours),
        page: { explain: !!document.querySelector(EXPLAIN_SELECTOR), peekRows: !!document.querySelector(PEEK_ROW_SELECTOR) }, prefs: p, session,
      });
      if (!n) return;
      writeSession(recordShown(session, n, Date.now()));
      setShown({ path: pathname, nudge: n });
    };
    timer = setTimeout(attempt, FIRST_LOOK_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pathname, hiddenPage, personaId, home]);

  // A nudge never lingers: it leaves 30 s after it appears, or after the pointer or focus leaves it.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holdNudge = () => clearTimeout(hideTimer.current);
  const releaseNudge = useCallback(() => { clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setShown(null), AUTO_HIDE_MS); }, []);
  useEffect(() => {
    if (!nudge) return;
    releaseNudge();
    return () => clearTimeout(hideTimer.current);
  }, [nudge, releaseNudge]);

  // Esc closes the panel and hands focus back to the bubble, unless focus is in a field, a menu or
  // a list box (the ask box included): there Esc belongs to that control.
  useEffect(() => {
    if (!assistant.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || dialogOpen()) return;
      const t = e.target as HTMLElement;
      if (typing() || t.closest?.('[role="menu"], [role="listbox"], [role="combobox"]')) return;
      const inPanel = !!t.closest?.('aside[aria-label="Ask Propniti"]');
      const fromBubble = assistant.openedFrom === "bubble";
      assistant.setOpen(false);
      if (fromBubble || inPanel) bubbleRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assistant]);

  // Focus goes back to the bubble whenever the nudge closes, so keyboard users aren't dropped on <body>.
  const dismiss = useCallback((n: Nudge) => { setPrefs((p) => dismissNudge(p, n)); setShown(null); bubbleRef.current?.focus(); }, [setPrefs]);
  const act = (n: Nudge) => {
    dismiss(n);
    const a = n.action;
    if (a.kind === "href") router.push(a.href);
    else if (a.kind === "ask") assistant.ask(a.prompt);
    else if (a.kind === "tour") startTour(a.tour);
    else document.querySelector<HTMLElement>(a.selector)?.click();
  };
  const setTips = (on: boolean) => {
    setPrefs((p) => ({ ...p, off: !on }));
    if (!on && nudge) { setShown(null); bubbleRef.current?.focus(); }
  };

  if (hiddenPage) return null;
  const open = assistant.open;
  const hidden = overlay;
  const style = { "--pn-panel": `${open ? assistant.width : 0}px`, "--pn-lift": `${lift}px` } as React.CSSProperties;

  return (
    <div
        data-chat-bubble-root
        style={style}
        className={cn(
          "group/bubble fixed right-4 z-40 flex flex-col items-end gap-2 transition-[right,bottom,opacity] duration-200 ease-out motion-reduce:transition-none print:hidden",
          "bottom-[calc(1rem+env(safe-area-inset-bottom)+var(--pn-lift))] sm:right-[calc(var(--pn-panel)+1rem)]",
          hidden && "pointer-events-none invisible opacity-0",
          open && "max-sm:hidden",
        )}
      >
        <div aria-live="polite" className="sr-only">{nudge && !hidden && !open && !tourActive ? `Suggestion: ${nudge.text}` : ""}</div>
        {nudge && !open && !tourActive && (
          <div
            data-guide-nudge={nudge.id}
            role="group"
            aria-label="Suggestion from Propniti"
            onPointerEnter={holdNudge}
            onPointerLeave={releaseNudge}
            onFocus={holdNudge}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) releaseNudge(); }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setShown(null); bubbleRef.current?.focus(); } }}
            className="relative w-[min(300px,calc(100vw-2rem))] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none"
          >
            <div className="mb-1 flex items-center gap-1.5 pr-5 text-[11px] text-muted-foreground">
              {nudge.source === "Tip" ? <Lightbulb className="size-3" /> : nudge.source === "Product tour" ? <Compass className="size-3" /> : <BarChart3 className="size-3" />}
              <span className="truncate">{nudge.source === "Tip" || nudge.source === "Product tour" ? nudge.source : `From ${nudge.source}`}</span>
            </div>
            <p className="text-[13px] leading-snug">{nudge.text}</p>
            <div className="mt-2.5 flex items-center gap-1.5">
              <Button size="xs" onClick={() => act(nudge)}>{nudge.action.label}</Button>
              <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setTips(false)}>Don&apos;t show tips</Button>
            </div>
            <button type="button" onClick={() => dismiss(nudge)} aria-label="Dismiss suggestion" className="absolute top-2 right-2 rounded p-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              <X className="size-3.5" />
            </button>
            <span aria-hidden className="absolute -bottom-[5px] right-[17px] size-2.5 rotate-45 border-r border-b bg-popover" />
          </div>
        )}

        <div className="relative">
          <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Assistant tips settings"
                className={cn(
                  "absolute -top-1.5 -left-1.5 z-10 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs outline-none transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none",
                  menuOpen ? "opacity-100" : "opacity-0 group-hover/bubble:opacity-100 pointer-coarse:opacity-100",
                  nudge && !open && "hidden",
                )}
              >
                <Ellipsis className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-56">
              <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Ask Propniti</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuCheckboxItem checked={!prefs.off} onCheckedChange={(v) => setTips(!!v)}>Show tips</DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
              {data.tours.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => startTour(data.tours[0].id)}><Compass /> Take the product tour</DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            ref={bubbleRef}
            type="button"
            data-chat-bubble
            onClick={() => assistant.setOpen(!open, "bubble")}
            aria-label={open ? "Close Ask Propniti" : "Open Ask Propniti"}
            aria-expanded={open}
            className={cn(
              "flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 ring-1 ring-black/5 outline-none",
              "transition-[background-color,transform,box-shadow] duration-150 hover:bg-primary/90 hover:shadow-xl active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
              "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:ring-white/10",
              "animate-in fade-in-0 zoom-in-90 duration-300 motion-reduce:animate-none",
            )}
          >
            {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
          </button>
        </div>
      </div>
  );
}

// The full-page assistant already fills /app/copilot, so the bubble (and the room toasts leave for it) isn't there.
export const showsBubble = (path: string) => path !== "/app/copilot";
