/* eslint-disable @next/next/no-img-element -- image optimisation is off on Workers; files are pre-sized webp */
import Link from "@/components/Link";
import { ArrowLeft } from "lucide-react";
import { Wordmark } from "@/components/Logo";
import { MK_VARS } from "./ui";

// Shell for the small account pages (signup, forgot password): content on the left, property
// photography on the right. The demo has no real accounts, so these pages explain the shared demo
// password and route to the sign-in page.
export function AuthShell({ title, subtitle, children }: { title: React.ReactNode; subtitle: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={MK_VARS} className="grid min-h-[100dvh] grid-cols-1 bg-(--mk-bg) font-sans text-(--mk-text) antialiased lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Propniti home"><Wordmark size={28} /></Link>
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] text-(--mk-muted) hover:bg-black/5 hover:text-(--mk-text)">
            <ArrowLeft aria-hidden className="size-4" /> Back to site
          </Link>
        </div>
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-14">
          <h1 className="text-balance text-[clamp(2rem,4vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.03em]">{title}</h1>
          <p className="mt-4 text-pretty text-[16px] leading-relaxed text-(--mk-muted)">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </main>
      </div>
      <aside className="relative hidden overflow-hidden bg-(--mk-ink) lg:block">
        <img src="/img/props/p03.webp" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,oklch(0.2_0.03_208/0.15)_30%,oklch(0.2_0.03_208/0.9)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 p-12 text-(--mk-on-ink)">
          <p className="max-w-md text-[26px] font-semibold leading-tight tracking-[-0.02em] text-white">Know your portfolio is right.</p>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-(--mk-on-ink-muted)">Mueller Park Residences, Austin. One of 30 properties in the demo portfolio.</p>
        </div>
      </aside>
    </div>
  );
}
