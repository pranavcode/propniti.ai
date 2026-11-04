"use client";
/* eslint-disable @next/next/no-img-element -- image optimisation is off on Workers; files are pre-sized webp */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, LoaderCircle, Lock } from "lucide-react";
import { DEMO_PASSWORD, LAST_PERSONA } from "@/auth/personas";
import { Wordmark } from "@/components/Logo";
import { MK_VARS } from "@/components/marketing/ui";

export type Card = { id: string; name: string; title: string; role: string; scope: string; sees: string; email: string; portal: boolean };
type Err = { field: "email" | "password" | "form"; message: string };

// Avatar tones from the brand palette: teal and its neighbours, light fill with dark text.
const TONES = [
  "bg-[oklch(0.92_0.04_192)] text-[oklch(0.34_0.07_198)]",
  "bg-[oklch(0.92_0.035_225)] text-[oklch(0.36_0.07_235)]",
  "bg-[oklch(0.93_0.04_165)] text-[oklch(0.36_0.07_165)]",
  "bg-[oklch(0.93_0.04_80)] text-[oklch(0.4_0.07_70)]",
];
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("");
const remember = (id: string) => {
  try {
    localStorage.setItem(LAST_PERSONA, id);
  } catch {}
};
const input = "h-11 w-full rounded-lg bg-white px-3.5 text-[15px] ring-1 ring-(--mk-line) outline-none transition-shadow placeholder:text-(--mk-muted)/70 focus-visible:ring-2 focus-visible:ring-(--mk-teal) aria-invalid:ring-2 aria-invalid:ring-[oklch(0.55_0.18_25)] aria-invalid:focus-visible:ring-[oklch(0.55_0.18_25)]";

export function SignIn({ cards, next, initialEmail, initialPassword, error: initialError, current, preselected }: {
  cards: Card[];
  next?: string;
  initialEmail: string;
  initialPassword: string;
  error?: Err;
  current?: { id: string; name: string; title: string; scope: string; href: string };
  preselected: boolean;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState(initialPassword);
  const [show, setShow] = useState(false);
  const [error, setError] = useState<Err | undefined>(initialError);
  const [pending, setPending] = useState(false);
  const [switching, setSwitching] = useState(!current);
  const [focusTick, setFocusTick] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const scrollTimer = useRef<number>(undefined);
  const match = cards.find((c) => c.email === email.trim().toLowerCase());
  const nextInput = next && <input type="hidden" name="next" value={next} />;

  const pick = (c: Card) => {
    setEmail(c.email);
    setPassword(DEMO_PASSWORD);
    setError(undefined);
    setSwitching(true);
    setFocusTick((t) => t + 1);
  };

  // Returning visitors: preselect the last person who signed in, unless the URL already chose.
  useEffect(() => {
    if (preselected) {
      if (initialError?.field === "password") passwordRef.current?.focus();
      else if (initialError) emailRef.current?.focus();
      else button.current?.focus();
      return;
    }
    if (current || initialEmail) return;
    let id: string | null = null;
    try {
      id = localStorage.getItem(LAST_PERSONA);
    } catch {}
    const c = cards.find((x) => x.id === id);
    if (!c) return;
    const f = requestAnimationFrame(() => pick(c));
    return () => cancelAnimationFrame(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // Focus the sign-in button so Enter signs in. Scroll to it only after the double-click window,
  // so a double-click on a card lower down still lands on the card.
  useEffect(() => {
    const b = button.current;
    if (!focusTick || !b) return;
    b.focus({ preventScroll: true });
    const r = b.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= window.innerHeight) return;
    scrollTimer.current = window.setTimeout(() => {
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      b.closest("form")?.scrollIntoView({ block: "center", behavior: still });
    }, 400);
    return () => window.clearTimeout(scrollTimer.current);
  }, [focusTick]);

  // Back from the next page (bfcache): the form must not stay stuck on "Signing in…".
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setPending(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    let err: Err;
    try {
      const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, next }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.href) {
        remember(body.persona);
        window.location.assign(body.href);
        return;
      }
      err = { field: body.field === "email" || body.field === "password" ? body.field : "form", message: body.error ?? "Couldn't sign in. Try again." };
    } catch {
      err = { field: "form", message: "Couldn't reach Propniti. Check your connection and try again." };
    }
    setError(err);
    setPending(false);
    if (err.field === "email") emailRef.current?.focus();
    if (err.field === "password") passwordRef.current?.select();
  }

  const staff = cards.filter((c) => !c.portal);
  const portals = cards.filter((c) => c.portal);
  const cardProps = { selected: match?.id, next, onPick: pick, onGo: () => window.clearTimeout(scrollTimer.current) };

  return (
    <div style={MK_VARS} className="min-h-[100dvh] bg-(--mk-bg) font-sans text-(--mk-text) antialiased">
      <header className="relative isolate overflow-hidden bg-(--mk-ink) text-(--mk-on-ink)">
        <img src="/img/marketing/hero-community.webp" alt="" className="absolute inset-0 -z-10 h-full w-full object-cover object-[center_40%]" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,oklch(0.2_0.03_208/0.85),oklch(0.2_0.03_208/0.95))]" />
        <div className="mx-auto max-w-7xl px-4 pb-10 pt-6 sm:px-6 lg:pb-16">
          <div className="flex items-center justify-between text-white">
            <Link href="/" aria-label="Propniti home"><Wordmark size={28} /></Link>
            <Link href="/" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] text-(--mk-on-ink-muted) hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
              <ArrowLeft aria-hidden className="size-4" /> Back to site
            </Link>
          </div>
          <div className="mt-8 grid items-center gap-8 lg:mt-14 lg:grid-cols-[1fr_440px] lg:gap-16">
            <div className="max-w-2xl">
              <h1 className="text-balance text-[clamp(2rem,5vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white">Sign in to the Propniti demo.</h1>
              <p className="mt-5 hidden text-pretty text-[17px] leading-relaxed text-(--mk-on-ink-muted) sm:block">
                Each person sees Propniti through their own role and scope: 30 properties, 18 months of history and the agents working alongside them. Switch role any time from your avatar menu in the top bar.
              </p>
              <p className="mt-6 hidden items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] text-white sm:inline-flex">
                <Lock aria-hidden className="size-3.5 text-(--mk-mint)" />
                Private demo data, resets at midnight Pacific.
              </p>
            </div>

            <div className="rounded-2xl bg-white p-5 text-(--mk-text) shadow-[0_24px_60px_-20px_oklch(0.1_0.03_208/0.6)] sm:p-7">
              {!switching && current ? (
                <div>
                  <p className="text-[14px] text-(--mk-muted)">You&apos;re signed in as</p>
                  <div className="mt-3 flex items-center gap-3">
                    <span aria-hidden className={`grid size-11 shrink-0 place-items-center rounded-full text-[15px] font-semibold ${TONES[Math.max(0, cards.findIndex((c) => c.id === current.id)) % TONES.length]}`}>{initials(current.name)}</span>
                    <div className="min-w-0">
                      <div className="truncate text-[17px] font-semibold">{current.name}</div>
                      <div className="truncate text-[14px] text-(--mk-muted)">{current.title} · {current.scope}</div>
                    </div>
                  </div>
                  <a href={current.href} className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-(--mk-teal) px-5 text-[15px] font-medium text-white transition-colors hover:bg-(--mk-teal-deep) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mk-teal)">
                    Continue as {current.name} <ArrowRight aria-hidden className="size-4" />
                  </a>
                  <a
                    href={`/login?switch=1${next ? `&next=${encodeURIComponent(next)}` : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      setSwitching(true);
                      requestAnimationFrame(() => emailRef.current?.focus());
                    }}
                    className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg px-5 text-[15px] font-medium ring-1 ring-(--mk-line) transition-colors hover:bg-(--mk-bg-2) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mk-teal)"
                  >
                    Switch person
                  </a>
                </div>
              ) : (
                <form action="/api/session" method="post" onSubmit={submit} aria-labelledby="signin-title">
                  <h2 id="signin-title" className="text-[20px] font-semibold tracking-[-0.01em]">Sign in</h2>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-(--mk-muted)">
                    Demo accounts: every person below signs in with password <code className="rounded bg-(--mk-teal-tint) px-1.5 py-0.5 font-mono text-[13px] font-medium text-(--mk-teal-deep)">{DEMO_PASSWORD}</code>
                  </p>
                  {nextInput}

                  <label htmlFor="signin-email" className="mt-5 block text-[14px] font-medium">Email</label>
                  <input
                    ref={emailRef}
                    id="signin-email"
                    name="email"
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    list="demo-emails"
                    placeholder="marcus@propniti.demo"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error?.field === "email") setError(undefined);
                    }}
                    aria-invalid={error?.field === "email" || undefined}
                    aria-describedby={`signin-who${error?.field === "email" ? " signin-error" : ""}`}
                    className={`mt-1.5 ${input}`}
                  />
                  <datalist id="demo-emails">
                    {cards.map((c) => <option key={c.id} value={c.email}>{c.name} · {c.title}</option>)}
                  </datalist>
                  <p id="signin-who" aria-live="polite" className="mt-1.5 min-h-5 truncate text-[13px] text-(--mk-muted)">
                    {match && <><Check aria-hidden className="mr-1 inline size-3.5 -translate-y-px text-(--mk-teal)" /><span className="font-medium text-(--mk-text)">{match.name}</span> · {match.role} · {match.scope}</>}
                  </p>

                  <label htmlFor="signin-password" className="mt-2 block text-[14px] font-medium">Password</label>
                  <div className="relative mt-1.5">
                    <input
                      ref={passwordRef}
                      id="signin-password"
                      name="password"
                      type={show ? "text" : "password"}
                      required
                      maxLength={200}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (error?.field === "password") setError(undefined);
                      }}
                      aria-invalid={error?.field === "password" || undefined}
                      aria-describedby={error?.field === "password" ? "signin-error" : undefined}
                      className={`${input} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShow((s) => !s)}
                      aria-label={show ? "Hide password" : "Show password"}
                      aria-pressed={show}
                      aria-controls="signin-password"
                      className="absolute inset-y-1 right-1 grid w-10 place-items-center rounded-md text-(--mk-muted) hover:bg-(--mk-bg-2) hover:text-(--mk-text) focus-visible:outline-2 focus-visible:outline-(--mk-teal)"
                    >
                      {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
                    </button>
                  </div>

                  <p id="signin-error" role="alert" className="mt-3 text-[14px] font-medium text-[oklch(0.5_0.17_25)] empty:mt-0">{error?.message}</p>

                  <button
                    ref={button}
                    type="submit"
                    disabled={pending}
                    aria-busy={pending || undefined}
                    className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-(--mk-teal) px-5 text-[15px] font-medium text-white transition-[background-color,transform] duration-150 hover:bg-(--mk-teal-deep) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mk-teal) active:scale-[0.99] disabled:cursor-wait disabled:opacity-80"
                  >
                    {pending ? <><LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> Signing in…</> : <>{match ? `Sign in as ${match.name}` : "Sign in"} <ArrowRight aria-hidden className="size-4" /></>}
                  </button>
                  <p className="mt-3 text-[13px] leading-relaxed text-(--mk-muted)">Or pick a person below: click a card to fill this form, double-click to sign in straight away.</p>
                </form>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <section aria-labelledby="staff" className="pt-10 lg:pt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="staff" className="text-[20px] font-semibold tracking-[-0.01em]">Staff</h2>
            <p className="text-[14px] text-(--mk-muted)">{staff.length} roles inside a property management company</p>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {staff.map((c, i) => <PersonaCard key={c.id} c={c} i={i} {...cardProps} />)}
          </div>
        </section>

        <section aria-labelledby="portals" className="pt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="portals" className="text-[20px] font-semibold tracking-[-0.01em]">Portals</h2>
            <p className="text-[14px] text-(--mk-muted)">Owners, residents, vendors and applicants see only their own records</p>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {portals.map((c, i) => <PersonaCard key={c.id} c={c} i={i + staff.length} {...cardProps} />)}
          </div>
        </section>

        <p className="mt-14 text-center text-[13px] text-(--mk-muted)">Fictional names and companies. No real payments or messages are sent.</p>
      </main>
    </div>
  );
}

// Without JavaScript the card is a one-click sign-in (a plain form post). With it, a click fills the
// sign-in form instead; a double-click or "Sign in now" posts the card's form directly.
function PersonaCard({ c, i, selected, next, onPick, onGo }: { c: Card; i: number; selected?: string; next?: string; onPick: (c: Card) => void; onGo: () => void }) {
  const [pending, setPending] = useState(false);
  const on = selected === c.id;
  return (
    <form action="/api/session" method="post" className="relative h-full" onSubmit={() => { remember(c.id); setPending(true); onGo(); }}>
      <input type="hidden" name="persona" value={c.id} />
      {next && <input type="hidden" name="next" value={next} />}
      <button
        type="submit"
        aria-label={`${c.name}, ${c.title}`}
        aria-pressed={on}
        data-persona={c.id}
        onClick={(e) => {
          e.preventDefault();
          onPick(c);
        }}
        onDoubleClick={(e) => e.currentTarget.form?.requestSubmit()}
        className={`group flex h-full w-full flex-col rounded-xl p-5 text-left transition-[box-shadow,transform,background-color] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mk-teal) active:translate-y-0 ${on ? "bg-[oklch(0.97_0.015_192)] ring-2 ring-(--mk-teal)" : "bg-white ring-1 ring-(--mk-line) hover:ring-(--mk-teal)/40"}`}
      >
        <div className="flex items-center gap-3">
          <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-full text-[14px] font-semibold ${TONES[i % TONES.length]}`}>{on ? <Check className="size-4" /> : initials(c.name)}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{c.name}</div>
            <div className="truncate text-[13px] text-(--mk-muted)">{c.title}</div>
          </div>
          {on ? <span aria-hidden className="w-28 shrink-0" /> : <ArrowRight aria-hidden className="size-4 shrink-0 text-(--mk-muted) transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-(--mk-teal)" />}
        </div>
        <div className="mt-3.5 flex flex-wrap gap-1.5 text-[12px]">
          <span className="rounded-md bg-(--mk-teal-tint) px-2 py-0.5 font-medium text-(--mk-teal-deep)">{c.role}</span>
          <span className="rounded-md bg-(--mk-bg-2) px-2 py-0.5 text-(--mk-muted)">{c.scope}</span>
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-(--mk-muted)">{c.sees}</p>
      </button>
      {on && (
        <button
          type="submit"
          disabled={pending}
          aria-label={`Sign in now as ${c.name}`}
          className="absolute right-4 top-[25px] inline-flex h-8 items-center gap-1.5 rounded-full bg-(--mk-teal) px-3 text-[13px] font-medium text-white hover:bg-(--mk-teal-deep) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mk-teal) disabled:opacity-80"
        >
          {pending ? <LoaderCircle aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
          Sign in now
        </button>
      )}
    </form>
  );
}
