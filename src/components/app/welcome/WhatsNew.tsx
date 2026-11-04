"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Compass } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { readLocal, useLocalStorage, writeLocal } from "@/hooks/use-local-storage";
import { useShell } from "../shell/context";
import { localTourStore } from "../tour/TourEngine";
import type { TourDef } from "../tour/types";
import { FEATURES, markSeen, newDot, pickToast, recordOffer, splashDue, toastBlockedBy, WHATS_NEW_KEY, type OfferOutcome, type WhatsNew as WhatsNewState } from "./rules";

// New-feature hints: a "new" dot on a feature's sidebar item until its page is visited, and one small
// toast per page view offering the feature's tour the first time it's met (rules in rules.ts).

const EMPTY: WhatsNewState = {};
const FIRST_LOOK_MS = 1500;          // let the page settle (and on-screen features mount)
const RETRY_MS = 4000;
const SHOW_MS = 20_000;

export const resetWhatsNew = () => writeLocal(WHATS_NEW_KEY, {});

const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
const offerTours = (tours: TourDef[]) => tours.map((t) => ({
  id: t.id, title: t.title, steps: t.steps.length, paths: t.steps.flatMap((s) => (s.href ? [s.href.split("?")[0]] : [])), status: localTourStore.get(t.id)?.status ?? null,
}));
const record = (tour: string, outcome: OfferOutcome) => writeLocal(WHATS_NEW_KEY, recordOffer(readLocal(WHATS_NEW_KEY, EMPTY), tour, outcome));

export function WhatsNew() {
  const { data, startTour, tourActive, assistant } = useShell();
  const pathname = usePathname();
  const { id: personaId, home } = data.persona;
  const live = useRef({ tours: data.tours, tourActive, startTour, panelOpen: assistant.open });
  useEffect(() => { live.current = { tours: data.tours, tourActive, startTour, panelOpen: assistant.open }; }, [data.tours, tourActive, startTour, assistant.open]);
  const idsKey = data.tours.map((t) => t.id).join(",");

  // Visiting a feature's page clears its dot.
  useEffect(() => {
    const s = readLocal(WHATS_NEW_KEY, EMPTY);
    const next = markSeen(s, pathname, idsKey.split(","));
    if (next !== s) writeLocal(WHATS_NEW_KEY, next);
  }, [pathname, idsKey]);

  // One look per page view. The splash's page view gets no toast; anything else on screen waits.
  useEffect(() => {
    if (splashDue(pathname, { id: personaId, home })) return;
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    let shown: string | number | undefined;
    const attempt = () => {
      const why = toastBlockedBy({
        splash: !!document.querySelector("[data-welcome-splash]"),
        dialog: dialogOpen(),
        peek: !!document.querySelector("[data-peek-drawer]"),
        tour: live.current.tourActive,
        nudge: !!document.querySelector("[data-guide-nudge]"),
        panel: live.current.panelOpen,
        shownThisView: false,
      });
      if (why) { if (++tries < 6) timer = setTimeout(attempt, RETRY_MS); return; }
      const state = readLocal(WHATS_NEW_KEY, EMPTY);
      const present = FEATURES.filter((f) => f.requires && document.querySelector(f.requires)).map((f) => f.id);
      const offer = pickToast({ path: pathname, tours: offerTours(live.current.tours), present, state });
      if (!offer) return;
      record(offer.tour, "shown");
      shown = toast.custom((id) => (
        <FeatureToast
          text={offer.text}
          onStart={() => { record(offer.tour, "started"); toast.dismiss(id); live.current.startTour(offer.tour); }}
          onLater={() => { record(offer.tour, "dismissed"); toast.dismiss(id); }}
        />
      ), { duration: SHOW_MS });
    };
    timer = setTimeout(attempt, FIRST_LOOK_MS);
    // The offer belongs to this page view.
    return () => { clearTimeout(timer); if (shown !== undefined) toast.dismiss(shown); };
  }, [pathname, personaId, home]);

  return null;
}

function FeatureToast({ text, onStart, onLater }: { text: string; onStart: () => void; onLater: () => void }) {
  return (
    <div data-feature-toast="" className="flex w-[356px] max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
      <Compass className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug">{text}</p>
        <div className="mt-2.5 flex items-center gap-1.5">
          <Button size="xs" onClick={onStart}>Start tour</Button>
          <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={onLater}>Not now</Button>
        </div>
      </div>
    </div>
  );
}

const noop = () => () => {};

// Whether a sidebar item carries the "new" dot. False until mounted, so server HTML never has one.
export function useNewDot(href: string) {
  const { data } = useShell();
  const [s] = useLocalStorage<WhatsNewState>(WHATS_NEW_KEY, EMPTY);
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const ids = useMemo(() => data.tours.map((t) => t.id), [data.tours]);
  return mounted && newDot(href, ids, s);
}

// A small teal dot after the label (on the icon's corner in the collapsed rail). It pulses, except
// under reduced motion.
export function NewDot({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  return (
    <span data-new-dot="" className={cn("relative flex size-1.5 shrink-0", collapsed && "absolute top-1 left-1", className)}>
      <span aria-hidden className="absolute inline-flex size-1.5 animate-ping rounded-full bg-primary opacity-60 [animation-duration:2s] motion-reduce:hidden" />
      <span aria-hidden className="relative inline-flex size-1.5 rounded-full bg-primary" />
      <span className="sr-only">(new)</span>
    </span>
  );
}
