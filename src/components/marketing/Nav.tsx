"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/Logo";

// Section links are absolute so they also work from other pages (e.g. /docs).
const links = [
  ["Product", "/#product"],
  ["How it works", "/#how"],
  ["Who it's for", "/#who"],
  ["Trust", "/#trust"],
  ["Docs", "/docs"],
];

const ease = "ease-[cubic-bezier(0.32,0.72,0,1)]";

export function Nav() {
  const [open, setOpen] = useState(false);
  // Close the full-screen menu with Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <header className="fixed inset-x-0 top-4 z-30 flex justify-center px-4">
        <div className="flex w-full max-w-3xl items-center gap-2 rounded-full bg-[#FBF9F4]/75 p-1.5 pl-5 shadow-[0_8px_40px_-12px_rgba(28,25,23,0.18)] ring-1 ring-[#1C1917]/[0.06] backdrop-blur-xl">
          <Link href="/" className="text-[#1C1917]" aria-label="Propniti home"><Wordmark size={28} /></Link>
          <nav className="ml-6 hidden items-center gap-6 text-[13px] text-[#57534E] md:flex">
            {links.map(([l, h]) => (
              <a key={h} href={h} className={`transition-colors duration-500 ${ease} hover:text-[#1C1917]`}>{l}</a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/login" className="hidden rounded-full px-4 py-2 text-[13px] text-[#44403C] hover:text-[#1C1917] sm:block">Sign in</Link>
            <Link href="/signup" className={`hidden rounded-full bg-[#1C1917] px-4 py-2 text-[13px] font-medium text-[#FBF9F4] transition-transform duration-500 ${ease} active:scale-[0.97] sm:block`}>Get started</Link>
            <button
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              className="relative grid h-10 w-10 place-items-center rounded-full md:hidden"
            >
              <span className={`absolute h-px w-5 bg-[#1C1917] transition-transform duration-500 ${ease} ${open ? "rotate-45" : "-translate-y-[4px]"}`} />
              <span className={`absolute h-px w-5 bg-[#1C1917] transition-transform duration-500 ${ease} ${open ? "-rotate-45" : "translate-y-[4px]"}`} />
            </button>
          </div>
        </div>
      </header>
      <div
        inert={!open}
        aria-hidden={!open}
        className={`fixed inset-0 z-20 bg-[#FBF9F4]/85 backdrop-blur-3xl transition-opacity duration-500 ${ease} md:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <nav className="flex h-full flex-col justify-center gap-2 px-8">
          {[...links, ["Sign in", "/login"], ["Get started", "/signup"]].map(([l, h], i) => (
            <a
              key={h}
              href={h}
              onClick={() => setOpen(false)}
              style={{ transitionDelay: open ? `${100 + i * 50}ms` : "0ms" }}
              className={`font-serif text-5xl text-[#1C1917] transition-[transform,opacity] duration-700 ${ease} ${open ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"}`}
            >
              {l}
            </a>
          ))}
        </nav>
      </div>
    </>
  );
}
