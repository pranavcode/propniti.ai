"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { adjacent, parsePeek, PEEK_PARAM, peekValue, withPeek, type PeekTarget } from "./url";

// Peek state lives in the URL (?peek=…) and changes through the native history API, which Next
// and vinext both sync into useSearchParams without a server round trip: the list behind the
// drawer keeps its rows, scroll and selection. Opening pushes one history entry so Back closes
// the drawer; moving between rows replaces it, so Back still closes rather than stepping back.

// The entity of the list on screen, so its rows can use a bare ?peek=<id>. A stack, because a
// record page's relation tab mounts a second list.
let pageEntities: string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const currentPageEntity = () => pageEntities[pageEntities.length - 1] ?? null;

export function usePeekPageEntity(entity: string) {
  useEffect(() => {
    pageEntities = [...pageEntities, entity];
    emit();
    return () => {
      const i = pageEntities.lastIndexOf(entity);
      pageEntities = pageEntities.filter((_, j) => j !== i);
      emit();
    };
  }, [entity]);
}

// True while the open drawer sits on a history entry this page pushed (so close = Back).
let pushed = false;
if (typeof window !== "undefined") window.addEventListener("popstate", () => { pushed = false; });

function writeUrl(value: string | null, mode: "push" | "replace") {
  const url = `${window.location.pathname}${withPeek(window.location.search, value)}${window.location.hash}`;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

export function openPeek(target: PeekTarget) {
  const value = peekValue(target, currentPageEntity());
  const isOpen = new URLSearchParams(window.location.search).has(PEEK_PARAM);
  if (isOpen) writeUrl(value, "replace");
  else { writeUrl(value, "push"); pushed = true; }
}

export function closePeek() {
  if (!new URLSearchParams(window.location.search).has(PEEK_PARAM)) return;
  if (pushed) { pushed = false; window.history.back(); }
  else writeUrl(null, "replace");
}

const ROW_SELECTOR = "[data-peek-entity][data-peek-id]";
const keyOf = (el: Element) => `${el.getAttribute("data-peek-entity")}:${el.getAttribute("data-peek-id")}`;

// Peekable links on the page, in document order (one per record), outside the drawer itself.
// Within a table, J/K stays in that table (a page can show several lists).
export function peekRows(scope: ParentNode = document): Element[] {
  const seen = new Set<string>();
  return [...scope.querySelectorAll(ROW_SELECTOR)].filter((el) => {
    if (el.closest("[data-peek-drawer]")) return false;
    const k = keyOf(el);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function peekRowElement(t: PeekTarget) {
  return peekRows().find((el) => keyOf(el) === `${t.entity}:${t.id}`) ?? null;
}

export function usePeek() {
  const params = useSearchParams();
  const pageEntity = useSyncExternalStore(subscribe, currentPageEntity, () => null);
  const target = parsePeek(params.get(PEEK_PARAM), pageEntity);

  const step = useCallback((dir: 1 | -1) => {
    if (!target) return false;
    const here = peekRowElement(target);
    const rows = peekRows(here?.closest("table") ?? document);
    const next = adjacent(rows.map(keyOf), `${target.entity}:${target.id}`, dir);
    const el = next ? rows.find((r) => keyOf(r) === next) : null;
    if (!el) return false;
    openPeek({ entity: el.getAttribute("data-peek-entity")!, id: el.getAttribute("data-peek-id")! });
    el.scrollIntoView({ block: "nearest" });
    return true;
  }, [target]);

  return { target, pageEntity, open: openPeek, close: closePeek, step };
}
