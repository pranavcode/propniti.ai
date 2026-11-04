"use client";

import { createContext, useContext, useEffect } from "react";
import type { Density, ShellData, Theme } from "./types";

// Shell state other components reach: the assistant dock (lane E renders inside it), the command
// palette, theme, density, breadcrumb titles and the tour.

export type AssistantState = {
  open: boolean;
  // `from` is "bubble" when the chat bubble opened it; the panel then shows the page guide.
  setOpen: (open: boolean, from?: "bubble") => void;
  openedFrom: "bubble" | null;
  // Open the panel from code, e.g. show({ reason: "auto" }) for the once-a-day auto-open.
  // "bubble" also shows the page guide, as the chat bubble does.
  show: (opts?: { reason?: "auto" | "bubble" | "tip" | "shortcut" }) => void;
  toggle: () => void;
  // Open the dock and hand it a question (from ⌘K "Ask AI", AskBox). A null query opens it on the
  // context without sending anything ("Ask about this": the person picks or types the question).
  ask: (query: string | null, context?: AssistantContext) => void;
  // The last question handed over and not yet taken. The dock calls take() to consume it.
  pending: { query: string | null; context?: AssistantContext; id: number } | null;
  take: () => void;
  width: number;
};

// What the user was looking at, so answers are context-aware.
export type AssistantContext = { entity?: string; id?: string; title?: string; path?: string };

export type ShellContext = {
  data: ShellData;
  assistant: AssistantState;
  openPalette: (query?: string) => void;
  openShortcuts: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  density: Density;
  setDensity: (d: Density) => void;
  crumbTitle: string | null;
  setCrumbTitle: (t: string | null) => void;
  startTour: (id?: string) => void;
  tourActive: boolean;
  openSetup: () => void;
};

export const ShellCtx = createContext<ShellContext | null>(null);

export function useShell() {
  const ctx = useContext(ShellCtx);
  if (!ctx) throw new Error("useShell must be used inside <AppShell>");
  return ctx;
}

// Optional variant for components that also render outside the shell (kit, portals).
export const useShellMaybe = () => useContext(ShellCtx);

export function useAssistant() {
  return useShell().assistant;
}

// Record pages call this so the breadcrumb shows "Properties / The Lofts at Riverside".
export function useBreadcrumbTitle(title: string | null | undefined) {
  const set = useShellMaybe()?.setCrumbTitle;
  useEffect(() => {
    if (!set) return;
    set(title ?? null);
    return () => set(null);
  }, [set, title]);
}
