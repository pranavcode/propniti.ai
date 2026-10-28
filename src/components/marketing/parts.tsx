import Link from "next/link";

export const ease = "ease-[cubic-bezier(0.32,0.72,0,1)]";

export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" className={className} aria-hidden>
      <path d="M5 11 11 5M6 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Pill button with the arrow nested in its own circle.
export function PillLink({ href, children, dark = true }: { href: string; children: React.ReactNode; dark?: boolean }) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-3 rounded-full py-2 pl-6 pr-2 text-sm font-medium transition-transform duration-500 ${ease} active:scale-[0.98] ${
        dark ? "bg-[#1C1917] text-[#FBF9F4]" : "bg-white/70 text-[#1C1917] ring-1 ring-[#1C1917]/10"
      }`}
    >
      {children}
      <span
        className={`grid h-8 w-8 place-items-center rounded-full transition-transform duration-500 ${ease} group-hover:translate-x-1 group-hover:-translate-y-[1px] group-hover:scale-105 ${
          dark ? "bg-white/10" : "bg-[#1C1917]/5"
        }`}
      >
        <Arrow className="h-4 w-4" />
      </span>
    </Link>
  );
}

export function Eyebrow({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] ${
        light ? "bg-white/10 text-[#E7E0D3] ring-1 ring-white/10" : "bg-[#1C1917]/[0.04] text-[#57534E] ring-1 ring-[#1C1917]/[0.06]"
      }`}
    >
      {children}
    </span>
  );
}

// Double-bezel: a machined outer tray holding the inner content plate.
export function Bezel({ children, className = "", inner = "", dark = false }: { children: React.ReactNode; className?: string; inner?: string; dark?: boolean }) {
  return (
    <div className={`rounded-[2rem] p-1.5 ${dark ? "bg-white/[0.04] ring-1 ring-white/10" : "bg-[#1C1917]/[0.035] ring-1 ring-[#1C1917]/[0.05]"} ${className}`}>
      <div
        className={`h-full overflow-hidden rounded-[calc(2rem-0.375rem)] ${
          dark ? "bg-[#26221F] shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]" : "bg-[#FFFDF8] shadow-[inset_0_1px_1px_rgba(255,255,255,0.9),0_24px_60px_-30px_rgba(28,25,23,0.25)]"
        } ${inner}`}
      >
        {children}
      </div>
    </div>
  );
}
