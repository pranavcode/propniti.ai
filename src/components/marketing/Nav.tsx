"use client";

import Link from "@/components/Link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Wordmark } from "@/components/Logo";

// Section links are absolute so they also work from other pages (e.g. /docs).
const links = [
  ["Product", "/#product"],
  ["Agents", "/#agents"],
  ["Who it's for", "/#who"],
  ["Security", "/security"],
  ["Pricing", "/pricing"],
  ["Docs", "/docs"],
];

// dark: variants apply only under a .dark ancestor, which only /docs sets (it follows the app theme).
// overDark: the page opens on a dark hero, so the bar starts transparent with light text and
// turns solid once the visitor scrolls. Book-demo is the one marketing page with a light top.
export function Nav({ overDark = false }: { overDark?: boolean }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const pathname = usePathname();
  const light = overDark && pathname !== "/book-demo" && !scrolled && !open;
  return (
    <header
      className={`fixed inset-x-0 top-0 z-30 transition-[background-color,box-shadow,color] duration-300 ease-out ${
        light ? "bg-transparent text-white" : "bg-white/90 text-[oklch(0.2_0.018_220)] shadow-[0_1px_0_oklch(0.9_0.008_200)] backdrop-blur-md dark:bg-[oklch(0.17_0.005_265)]/90 dark:text-[oklch(0.96_0.003_265)] dark:shadow-[0_1px_0_oklch(1_0_0/0.1)]"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-4 sm:px-6">
        <Link href="/" aria-label="Propniti home" className="shrink-0"><Wordmark size={28} /></Link>
        <nav aria-label="Main" className="hidden items-center gap-7 text-[14px] lg:flex">
          {links.map(([l, h]) => (
            <a key={h} href={h} className={`transition-opacity duration-200 hover:opacity-100 ${light ? "opacity-80" : "opacity-70"}`}>{l}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/login" className={`hidden h-9 items-center rounded-full px-4 text-[14px] sm:inline-flex ${light ? "hover:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/10"}`}>Try the live demo</Link>
          <Link
            href="/book-demo"
            className={`hidden h-9 items-center rounded-full px-4 text-[14px] font-medium transition-colors duration-200 sm:inline-flex ${
              light ? "bg-white text-[oklch(0.2_0.03_208)] hover:bg-[oklch(0.94_0.03_192)]" : "bg-[oklch(0.47_0.085_195)] text-white hover:bg-[oklch(0.36_0.07_198)]"
            }`}
          >
            Book a demo
          </Link>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mk-menu"
            className="grid size-10 place-items-center rounded-full lg:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      <div
        id="mk-menu"
        inert={!open}
        className={`border-t border-[oklch(0.9_0.008_200)] bg-white transition-[opacity,transform] dark:border-white/10 dark:bg-[oklch(0.17_0.005_265)] duration-200 ease-out lg:hidden ${open ? "translate-y-0 opacity-100" : "pointer-events-none absolute inset-x-0 -translate-y-2 opacity-0"}`}
      >
        <nav aria-label="Mobile" className="mx-auto flex max-w-7xl flex-col px-4 py-3 sm:px-6">
          {[...links, ["Try the live demo", "/login"], ["Book a demo", "/book-demo"]].map(([l, h]) => (
            <a key={h} href={h} onClick={() => setOpen(false)} className="rounded-lg px-2 py-3 text-[17px] hover:bg-black/5 dark:hover:bg-white/10">{l}</a>
          ))}
        </nav>
      </div>
    </header>
  );
}
