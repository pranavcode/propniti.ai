"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { readLocal, writeLocal } from "@/hooks/use-local-storage";
import type { GuidePrefs } from "../guide/nudges";
import { useShell } from "../shell/context";
import { ASK_AUTO_KEY, askAutoDue, askAutoOpened, askGate, demoDay, type AskAuto } from "./rules";

// Opens the Ask Propniti panel on its own once a demo day per persona (rules in rules.ts): after
// the welcome splash closes, or on the day's first page view when there is no splash.

const FIRST_LOOK_MS = 1200;
const RETRY_MS = 1000;
const MAX_TRIES = 60;      // a minute of waiting for the splash, a dialog or a tour to finish
const NONE: AskAuto = {};

const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');

export function AskAutoOpen() {
  const { data, assistant, tourActive } = useShell();
  const pathname = usePathname();
  const { id } = data.persona;
  const live = useRef({ assistant, tourActive });
  useEffect(() => { live.current = { assistant, tourActive }; }, [assistant, tourActive]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    const attempt = () => {
      const a = live.current.assistant;
      const day = demoDay();
      const prefs = readLocal(ASK_AUTO_KEY, NONE);
      const due = askAutoDue({
        prefs, persona: id, day, path: pathname, phone: !window.matchMedia("(min-width: 640px)").matches,
        tipsOff: !!readLocal<GuidePrefs>("pn_guide", {}).off, panelOpen: a.open,
      });
      if (!due) return;
      const gate = askGate({
        splash: !!document.querySelector("[data-welcome-splash]"),
        dialog: dialogOpen(),
        tour: live.current.tourActive,
        peek: !!document.querySelector("[data-peek-drawer]"),
        toast: !!document.querySelector("[data-feature-toast]"),
      });
      if (gate === "wait" && ++tries < MAX_TRIES) timer = setTimeout(attempt, RETRY_MS);
      if (gate !== "go") return;
      writeLocal(ASK_AUTO_KEY, askAutoOpened(prefs, id, day));
      a.show({ reason: "auto" });
    };
    timer = setTimeout(attempt, FIRST_LOOK_MS);
    return () => clearTimeout(timer);
  }, [pathname, id]);

  return null;
}
