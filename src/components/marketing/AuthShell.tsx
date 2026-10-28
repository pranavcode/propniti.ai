"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Bezel } from "./parts";
import { Wordmark } from "@/components/Logo";

export function AuthShell({ title, subtitle, children, footer }: { title: React.ReactNode; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="grid min-h-[100dvh] grid-cols-1 bg-[#F6F2EA] text-[#1C1917] lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" aria-label="Propniti home"><Wordmark size={32} text="text-3xl" /></Link>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
          <h1 className="font-serif text-5xl leading-[1] tracking-[-0.01em]">{title}</h1>
          <p className="mt-3 text-[15px] text-[#57534E]">{subtitle}</p>
          <Bezel className="mt-8" inner="p-6 sm:p-8">{children}</Bezel>
          <div className="mt-6 text-center text-sm text-[#57534E]">{footer}</div>
          <p className="mt-8 text-center text-xs text-[#78716C]">Demo: no real accounts. Any email works and nothing is sent.</p>
        </div>
      </div>
      <aside className="relative hidden overflow-hidden rounded-l-[3rem] bg-[#1C1917] p-12 text-[#F6F2EA] lg:flex lg:flex-col">
        <div aria-hidden className="absolute -right-40 -top-40 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(214,184,143,0.22),transparent)]" />
        <div className="relative mt-auto max-w-md">
          <Bezel dark inner="p-6">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-[#A8A29E]">
              Agent · overnight <span className="h-1.5 w-1.5 rounded-full bg-[#9DB38A]" />
            </div>
            <ul className="mt-4 space-y-3 text-sm">
              <li>2 rent reminders sent by SMS</li>
              <li>Invoice WO-1041 matched its PO · 97%</li>
              <li>Lease renewal offer sent to #204</li>
            </ul>
            <div className="mt-5 rounded-2xl bg-white/5 px-4 py-3 text-sm text-[#D6B88F]">1 payment waiting for your approval</div>
          </Bezel>
          <p className="mt-10 font-serif text-4xl leading-tight">
            Wake up to a portfolio that <em className="text-[#D6B88F]">already did its chores.</em>
          </p>
        </div>
      </aside>
    </div>
  );
}

export const field =
  "mt-1.5 w-full rounded-2xl border-0 bg-[#F6F2EA]/70 px-4 py-3 text-[15px] text-[#1C1917] ring-1 ring-inset ring-[#1C1917]/10 placeholder:text-[#A8A29E] transition-shadow duration-300 focus:outline-none focus:ring-2 focus:ring-[#1C1917]";

// False during SSR and before hydration, so forms can't submit natively (which would put
// field values in the URL) before React has attached its handlers.
const useHydrated = () => useSyncExternalStore(() => () => {}, () => true, () => false);

export function SubmitButton({ children, busy }: { children: React.ReactNode; busy?: boolean }) {
  const hydrated = useHydrated();
  return (
    <button
      type="submit"
      disabled={busy || !hydrated}
      className="group mt-2 flex w-full items-center justify-between rounded-full bg-[#1C1917] py-2 pl-6 pr-2 text-sm font-medium text-[#FBF9F4] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] disabled:opacity-60"
    >
      {children}
      <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1 group-hover:-translate-y-[1px]">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" className="h-4 w-4" aria-hidden>
          <path d="M5 11 11 5M6 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}
