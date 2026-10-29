"use client";

import Link from "next/link";
import { useState } from "react";
import { PERSONAS } from "@/lib/seed";
import type { PersonaId } from "@/lib/types";

const ease = "ease-[cubic-bezier(0.32,0.72,0,1)]";

// Demo-only control, deliberately styled apart from the product: a real user
// never switches roles, so this lives outside the app chrome.
export function DemoSwitcher({ persona }: { persona: PersonaId }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-5 left-1/2 z-20 -translate-x-1/2">
      {open && (
        <div className="mb-2 w-72 rounded-[1.5rem] bg-[#1C1917] p-2 text-[#F6F2EA] shadow-[0_24px_60px_-20px_rgba(28,25,23,0.6)] ring-1 ring-white/10">
          <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.2em] text-[#A8A29E]">View the demo as</div>
          {(Object.keys(PERSONAS) as PersonaId[]).map((p) => (
            <Link
              key={p}
              href={`/${p}`}
              onClick={() => setOpen(false)}
              className={`flex items-center justify-between rounded-2xl px-3 py-2 text-sm transition-colors duration-300 ${p === persona ? "bg-white/10" : "hover:bg-white/5"}`}
            >
              {PERSONAS[p].label}
              {p === persona && <span className="h-1.5 w-1.5 rounded-full bg-[#D6B88F]" />}
            </Link>
          ))}
          <Link href="/demo" className="mt-1 block rounded-2xl px-3 py-2 text-xs text-[#A8A29E] hover:bg-white/5">All personas</Link>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex items-center gap-3 whitespace-nowrap rounded-full bg-[#1C1917] py-2 pl-2 pr-4 text-[13px] text-[#F6F2EA] shadow-[0_16px_40px_-16px_rgba(28,25,23,0.6)] ring-1 ring-white/10 transition-transform duration-500 ${ease} active:scale-[0.97]`}
      >
        <span className="rounded-full bg-[#D6B88F] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#1C1917]">Demo</span>
        Viewing as {PERSONAS[persona].label.toLowerCase()}
        <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 transition-transform duration-500 ${ease} ${open ? "" : "rotate-180"}`} fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden>
          <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
