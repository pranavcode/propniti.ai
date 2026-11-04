"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, LogOut, UserRoundCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { ChatBubble, showsBubble } from "../guide/ChatBubble";
import { pageGuide } from "../guide/pages";
import { SetupChecklist } from "../onboarding/SetupChecklist";
import { TourOverlay, useTour } from "../tour/TourEngine";
import { AskAutoOpen } from "../welcome/AskAutoOpen";
import { WelcomeSplash } from "../welcome/WelcomeSplash";
import { WhatsNew } from "../welcome/WhatsNew";
import { AI_MAX_W, AI_MIN_W, AssistantPanel } from "./AssistantPanel";
import { CommandPalette } from "./CommandPalette";
import { ShellCtx, useShell, type AssistantContext, type ShellContext } from "./context";
import { exitPersona } from "./persona";
import { NavProgress } from "./NavProgress";
import { gotoTargets, ShortcutsDialog } from "./shortcuts";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import type { Density, ShellData, Theme } from "./types";

const setCookie = (k: string, v: string) => (document.cookie = `${k}=${v}; Path=/; Max-Age=31536000; SameSite=Lax`);

// The app frame: sidebar, top bar, "Viewing as" banner, main content and the assistant dock.
// `assistant` is the dock body (lane E); `children` is the page.
export function AppShell({ data, assistant: assistantBody, children }: { data: ShellData; assistant?: React.ReactNode; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(data.sidebarOpen);
  const [mobileNav, setMobileNav] = useState(false);
  const [palette, setPalette] = useState<{ open: boolean; q: string }>({ open: false, q: "" });
  const [shortcuts, setShortcuts] = useState(false);
  const [setup, setSetup] = useState(false);
  const [profileMenu, setProfileMenu] = useState<ShellContext["profileMenu"]>(false);
  const [theme, setThemeState] = useState<Theme>(data.theme);
  const [density, setDensityState] = useState<Density>(data.density);
  const [crumbTitle, setCrumbTitle] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useLocalStorage<boolean>("pn_ai_open", false);
  const [aiWidth, setAiWidth] = useLocalStorage<number>("pn_ai_w", 400);
  const [pending, setPending] = useState<{ query: string | null; context?: AssistantContext; id: number } | null>(null);
  const [aiFrom, setAiFrom] = useState<"bubble" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const tour = useTour(data.tours);
  const touring = !!tour.active;

  // Theme: .dark on <html> so portals (dialogs, popovers) match. Removed when leaving the app.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
      rootRef.current?.closest("[data-surface]")?.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => () => { document.documentElement.classList.remove("dark"); document.documentElement.style.colorScheme = ""; }, []);

  const setTheme = useCallback((t: Theme) => { setThemeState(t); setCookie("pn_theme", t); }, []);
  const setDensity = useCallback((d: Density) => { setDensityState(d); setCookie("pn_density", d); }, []);
  const toggleSidebar = useCallback(() => setSidebarOpen((o) => { setCookie("sidebar_state", String(!o)); return !o; }), []);

  const assistant = useMemo(() => ({
    open: aiOpen,
    setOpen: (open: boolean, from?: "bubble") => { setAiFrom(open ? from ?? null : null); setAiOpen(open); },
    show: (opts?: { reason?: "auto" | "bubble" | "tip" | "shortcut" }) => { setAiFrom(opts?.reason === "bubble" ? "bubble" : null); setAiOpen(true); },
    openedFrom: aiOpen ? aiFrom : null,
    toggle: () => { setAiFrom(null); setAiOpen((o) => !o); },
    ask: (query: string | null, context?: AssistantContext) => { setPending({ query, context, id: Date.now() }); if (!aiOpen) setAiFrom(null); setAiOpen(true); },
    pending,
    take: () => setPending(null),
    width: Math.min(AI_MAX_W, Math.max(AI_MIN_W, aiWidth)),
  }), [aiOpen, setAiOpen, aiFrom, pending, aiWidth]);

  // The assistant's suggested questions follow the page (property, collections, approvals…), then the persona's.
  const prompts = pageGuide(pathname, { nav: data.nav.flatMap((s) => s.items), personaPrompts: data.assistantPrompts }).prompts;
  const promptsKey = prompts.join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pageData = useMemo(() => ({ ...data, assistantPrompts: prompts }), [data, promptsKey]);

  const ctx: ShellContext = useMemo(() => ({
    data: pageData,
    assistant,
    openPalette: (q = "") => setPalette({ open: true, q }),
    openShortcuts: () => setShortcuts(true),
    theme, setTheme, density, setDensity,
    crumbTitle, setCrumbTitle,
    startTour: tour.start,
    tourActive: touring,
    openSetup: () => setSetup(true),
    profileMenu, setProfileMenu,
  }), [pageData, assistant, theme, setTheme, density, setDensity, crumbTitle, tour.start, touring, profileMenu]);

  const goto = useMemo(() => Object.fromEntries(gotoTargets(data.nav).map((g) => [`g ${g.key}`, () => router.push(g.href)])), [data.nav, router]);
  useHotkeys({
    "mod+k": () => setPalette((p) => ({ open: !p.open, q: "" })),
    "mod+j": () => assistant.toggle(),
    "mod+b": toggleSidebar,
    "?": () => setShortcuts(true),
    "/": () => {
      const search = document.querySelector<HTMLInputElement>("[data-table-search]");
      if (search) search.focus(); else setPalette({ open: true, q: "" });
    },
    ...goto,
  });

  return (
    <ShellCtx.Provider value={ctx}>
      <TooltipProvider delayDuration={300}>
        <div ref={rootRef} data-density={density} className="relative flex h-dvh w-full overflow-hidden bg-background">
          <a href="#main" className="sr-only z-50 rounded bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Skip to content</a>

          <div className={cn("hidden shrink-0 border-r border-sidebar-border transition-[width] duration-200 ease-out motion-reduce:transition-none lg:block", sidebarOpen ? "w-[244px]" : "w-[52px]")}>
            <Sidebar collapsed={!sidebarOpen} onToggle={toggleSidebar} />
          </div>
          <Sheet open={mobileNav} onOpenChange={setMobileNav}>
            <SheetContent side="left" className="w-[272px] p-0 sm:max-w-[272px]" showCloseButton={false}>
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Sidebar collapsed={false} onNavigate={() => setMobileNav(false)} />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col">
            {data.viewingAs && <ViewingAsBanner />}
            <TopBar onMenu={() => setMobileNav(true)} />
            <div className="flex min-h-0 flex-1">
              <main id="main" tabIndex={-1} className="relative min-w-0 flex-1 overflow-y-auto outline-none [scrollbar-gutter:stable]">
                {children}
              </main>
              <AssistantPanel onResize={setAiWidth}>{assistantBody}</AssistantPanel>
            </div>
          </div>
        </div>

        <CommandPalette open={palette.open} initialQuery={palette.q} onOpenChange={(o) => setPalette((p) => ({ ...p, open: o }))} />
        <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} nav={data.nav} />
        <Dialog open={setup} onOpenChange={setSetup}>
          <DialogContent className="max-w-[560px] sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>Set up your workspace</DialogTitle>
              <DialogDescription>Six steps to go live. Each one links to the page that does it.</DialogDescription>
            </DialogHeader>
            <SetupChecklist onNavigate={() => setSetup(false)} />
          </DialogContent>
        </Dialog>
        <NavProgress commit={children} />
        <TourOverlay active={tour.active} go={tour.go} dismiss={tour.dismiss} />
        <ChatBubble />
        <WelcomeSplash />
        <WhatsNew />
        <AskAutoOpen />
        {/* Toasts sit above the chat bubble. */}
        <Toaster theme={theme} position="bottom-right" closeButton {...(showsBubble(pathname) && { offset: { bottom: 76 }, mobileOffset: { bottom: 76 } })} />
      </TooltipProvider>
    </ShellCtx.Provider>
  );
}

function ViewingAsBanner() {
  const { data, setProfileMenu } = useShell();
  const p = data.persona;
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-primary/15 bg-primary/[0.06] px-3 text-[12.5px] md:px-4">
      <Eye className="size-3.5 text-primary" />
      <span className="min-w-0 truncate">
        Viewing as <span className="font-medium">{p.name}</span>
        <span className="text-muted-foreground"> · {p.title} · {p.scopeLabel}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <button onClick={() => setProfileMenu("switch")} className="inline-flex h-6 items-center gap-1 rounded px-2 text-primary hover:bg-primary/10"><UserRoundCog className="size-3.5" /> Switch</button>
        <button onClick={exitPersona} className="inline-flex h-6 items-center gap-1 rounded px-2 text-muted-foreground hover:bg-primary/10 hover:text-foreground"><LogOut className="size-3.5" /> Exit</button>
      </span>
    </div>
  );
}
