"use client";

import Link from "@/components/Link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { readLocal, writeLocal } from "@/hooks/use-local-storage";
import { personaGreeting } from "@/lib/format";
import { loadFacts } from "../guide/ChatBubble";
import type { GuideFacts } from "../guide/nudges";
import { AppMark } from "../shell/AppMark";
import { useShell } from "../shell/context";
import { demoDay, dismissWelcome, neverWelcome, restoreWelcome, ROLE_LINE, splashDue, waitingItems, WELCOME_KEY, WHATS_NEW_KEY, whatsNewBullets, type WelcomePrefs } from "./rules";

// The welcome splash on the persona's home: a greeting, what Propniti does for their role, what's
// new and up to three things waiting for them (counts from /api/guide). Once a demo day per
// persona; "Don't show again" turns it off until Help › Show welcome screen.

const EVENT = "pn:welcome";
const NONE: WelcomePrefs = {};

// Help › Show welcome screen.
export const showWelcome = () => window.dispatchEvent(new Event(EVENT));
// For a "Reset layout" action: the splash and the new-feature dots and toasts come back.
export function resetWelcome() {
  writeLocal(WELCOME_KEY, {});
  writeLocal(WHATS_NEW_KEY, {});
}

export function WelcomeSplash() {
  const { data, startTour } = useShell();
  const pathname = usePathname();
  const { id, home } = data.persona;
  const [open, setOpen] = useState(false);
  // undefined while loading, null when the counts couldn't load.
  const [facts, setFacts] = useState<GuideFacts | null | undefined>(undefined);
  const primary = useRef<HTMLButtonElement>(null);

  // Decided after mount from localStorage, so the server never renders it and nothing flashes.
  useEffect(() => {
    if (!splashDue(pathname, { id, home })) return;
    const t = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(t);
  }, [pathname, id, home]);

  useEffect(() => {
    const show = () => { writeLocal(WELCOME_KEY, restoreWelcome(readLocal(WELCOME_KEY, NONE), id)); setOpen(true); };
    window.addEventListener(EVENT, show);
    return () => window.removeEventListener(EVENT, show);
  }, [id]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    loadFacts(id).then((f) => { if (live) setFacts(f); });
    return () => { live = false; };
  }, [open, id]);

  const close = (forever = false) => {
    const prefs = readLocal(WELCOME_KEY, NONE);
    writeLocal(WELCOME_KEY, forever ? neverWelcome(prefs, id) : dismissWelcome(prefs, id, demoDay()));
    setOpen(false);
  };
  const tour = () => { close(); startTour("app-basics"); };

  if (!open) return null;
  const p = data.persona;
  const greeting = personaGreeting({ name: p.name, scope: { label: p.scopeLabel }, title: p.title });
  const tourIds = data.tours.map((t) => t.id);
  const bullets = whatsNewBullets(tourIds);
  const items = waitingItems(facts ?? null, data.nav.flatMap((s) => s.items.map((i) => i.href)));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent
        data-welcome-splash=""
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 motion-reduce:animate-none sm:max-w-[600px]"
        onOpenAutoFocus={(e) => { e.preventDefault(); primary.current?.focus(); }}
        onCloseAutoFocus={(e) => { if (document.activeElement === document.body || !document.activeElement) { e.preventDefault(); document.getElementById("main")?.focus(); } }}
      >
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground"><AppMark size={24} /> Propniti</div>
          <DialogTitle className="mt-4 text-[20px] font-semibold tracking-tight">{greeting}</DialogTitle>
          <DialogDescription className="mt-1.5 max-w-[52ch] text-[13.5px] leading-relaxed">{ROLE_LINE[p.role]}</DialogDescription>
        </div>

        <div className="grid gap-x-6 gap-y-5 border-t bg-muted/40 px-6 py-5 sm:grid-cols-2">
          {bullets.length > 0 && (
            <section aria-labelledby="welcome-new">
              <h3 id="welcome-new" className="text-[12px] font-medium text-muted-foreground">What&apos;s new</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {bullets.map((b) => (
                  <li key={b.name} className="flex gap-2 text-[13px] leading-snug">
                    <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-primary" />
                    <span><span className="font-medium">{b.name}</span><span className="text-muted-foreground">: {b.text}</span></span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="welcome-waiting" aria-busy={facts === undefined}>
            <h3 id="welcome-waiting" className="text-[12px] font-medium text-muted-foreground">Waiting for you</h3>
            {facts === undefined ? (
              <div className="mt-2 flex flex-col gap-2" aria-hidden>{[0, 1, 2].map((i) => <div key={i} className="h-[34px] animate-pulse rounded-md bg-muted motion-reduce:animate-none" />)}</div>
            ) : items.length ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {items.map((w) => (
                  <li key={w.id}>
                    <Link href={w.href} onClick={() => close()} className="group flex items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-[13px] leading-snug outline-none transition-colors hover:border-primary/40 hover:bg-primary/[0.04] focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none">
                      <span className="min-w-0 flex-1 tabular-nums">{w.text}</span>
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] leading-snug text-muted-foreground">{facts === null ? "Your counts couldn't load. Your home page lists what needs you." : "Nothing is waiting on you right now."}</p>
            )}
          </section>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:items-center">
          <button type="button" onClick={() => close(true)} className="self-center rounded text-[12.5px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 sm:mr-auto sm:self-auto">Don&apos;t show again</button>
          <Button variant="outline" onClick={() => close()}>Go to dashboard</Button>
          <Button ref={primary} onClick={tour}><Compass /> Take the 2-minute tour</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
