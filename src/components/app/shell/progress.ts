// The top progress bar's state: a navigation, search-param change or refresh starts it, the next
// committed render ends it. It waits REVEAL_MS before showing, so fast transitions never flash.

export type NavPhase = "idle" | "waiting" | "running" | "finishing";
export type NavEvent = "start" | "reveal" | "done" | "settled";

export const REVEAL_MS = 150;
export const SETTLE_MS = 350;
const GIVE_UP_MS = 15_000;

export function navReducer(phase: NavPhase, event: NavEvent): NavPhase {
  switch (event) {
    case "start": return phase === "idle" ? "waiting" : phase === "finishing" ? "running" : phase;
    case "reveal": return phase === "waiting" ? "running" : phase;
    case "done": return phase === "waiting" ? "idle" : phase === "running" ? "finishing" : phase;
    case "settled": return phase === "finishing" ? "idle" : phase;
  }
}

let phase: NavPhase = "idle";
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function send(event: NavEvent) {
  const next = navReducer(phase, event);
  if (next === phase) return;
  phase = next;
  clearTimeout(timer);
  if (phase === "waiting") timer = setTimeout(() => send("reveal"), REVEAL_MS);
  else if (phase === "running") timer = setTimeout(() => send("done"), GIVE_UP_MS);
  else if (phase === "finishing") timer = setTimeout(() => send("settled"), SETTLE_MS);
  listeners.forEach((l) => l());
}

export const navStart = () => send("start");
// Runs `fn` once the current navigation or refresh has committed (the bar's "done").
export function afterNav(fn: () => void) {
  const off = subscribeNav(() => { if (phase === "finishing" || phase === "idle") { off(); fn(); } });
}
export const navDone = () => send("done");
export const navPhase = () => phase;
export function subscribeNav(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

// True when going to `href` would change the page or its search params (not a hash jump).
export function changesPage(href: string, from: { pathname: string; search: string; origin: string }) {
  const u = new URL(href, from.origin + from.pathname + from.search);
  return u.origin === from.origin && (u.pathname !== from.pathname || u.search !== from.search);
}

// router.push/replace/refresh are called from many components; wrap the app router instance once
// (window.next.router, the object useRouter hands out) so every call starts the bar.
type Router = { push: (h: string, o?: unknown) => void; replace: (h: string, o?: unknown) => void; refresh: () => void; __pnProgress?: true };
export function trackRouter() {
  if (typeof window === "undefined") return;
  const r = (window as { next?: { router?: Router } }).next?.router;
  if (!r || r.__pnProgress) return;
  r.__pnProgress = true;
  const { push, replace, refresh } = r;
  const moves = (href: string) => changesPage(href, window.location);
  r.push = (href, o) => { if (moves(href)) navStart(); push.call(r, href, o); };
  r.replace = (href, o) => { if (moves(href)) navStart(); replace.call(r, href, o); };
  r.refresh = () => { navStart(); refresh.call(r); };
}
trackRouter();
