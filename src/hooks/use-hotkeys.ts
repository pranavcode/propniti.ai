"use client";

import { useEffect, useRef } from "react";

// Keyboard shortcuts. Combos: "mod+k" (⌘ on Mac, Ctrl elsewhere), "shift+?", single keys ("j",
// "/"), and two-key sequences ("g p"). Plain keys never fire while typing in a field. A handler
// that returns false declines the key, so the browser default (and other handlers) still run.

export type Hotkeys = Record<string, (e: KeyboardEvent) => unknown>;

export function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.closest?.("[role=dialog] [cmdk-input], [contenteditable=true]");
}

function matches(combo: string, e: KeyboardEvent) {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop()!;
  const mod = parts.includes("mod");
  if (mod !== (e.metaKey || e.ctrlKey)) return false;
  if (parts.includes("alt") !== e.altKey) return false;
  return e.key.toLowerCase() === key;
}

export function useHotkeys(keys: Hotkeys, enabled = true) {
  const ref = useRef(keys);
  useEffect(() => { ref.current = keys; });

  useEffect(() => {
    if (!enabled) return;
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const typing = isTypingTarget(e.target);
      for (const [combo, fn] of Object.entries(ref.current)) {
        if (combo.includes("mod+")) {
          if (matches(combo, e) && fn(e) !== false) { e.preventDefault(); return; }
          continue;
        }
        if (typing || e.metaKey || e.ctrlKey || e.altKey) continue;
        const seq = combo.split(" ");
        if (seq.length === 2) {
          if (pending === seq[0] && e.key.toLowerCase() === seq[1]) { pending = null; if (fn(e) !== false) { e.preventDefault(); return; } }
        } else if ((e.key === combo || (combo.startsWith("shift+") && e.key === combo.slice(6))) && fn(e) !== false) {
          e.preventDefault(); return;
        }
      }
      // Arm a sequence prefix ("g") for one second.
      if (!typing && !e.metaKey && !e.ctrlKey && Object.keys(ref.current).some((c) => c.startsWith(e.key.toLowerCase() + " "))) {
        pending = e.key.toLowerCase();
        clearTimeout(timer);
        timer = setTimeout(() => (pending = null), 1000);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(timer); };
  }, [enabled]);
}
