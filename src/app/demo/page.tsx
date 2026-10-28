import Link from "next/link";
import { Arrow, Bezel, Eyebrow, ease } from "@/components/marketing/parts";
import { PERSONAS } from "@/lib/seed";
import type { PersonaId } from "@/lib/types";
import { Wordmark } from "@/components/Logo";

const names: Record<PersonaId, string> = {
  pm: "Maya Patel",
  owner: "Robert Chen",
  tenant: "Jasmine Brooks",
  maintenance: "Luis Romero",
  vendor: "Derek Simmons · CoolAir HVAC",
  admin: "Sam Okafor",
};

export default function Demo() {
  return (
    <main className="min-h-[100dvh] bg-[#F6F2EA] px-4 pb-24 pt-8 text-[#1C1917]">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Propniti home"><Wordmark size={32} text="text-3xl" /></Link>
          <Link href="/login" className="rounded-full px-4 py-2 text-[13px] text-[#44403C] ring-1 ring-[#1C1917]/10 hover:bg-white/60">Sign in</Link>
        </div>
        <div className="mt-20 max-w-3xl">
          <Eyebrow>Live demo · sample portfolio</Eyebrow>
          <h1 className="mt-6 font-serif text-[clamp(3rem,7vw,6rem)] leading-[0.95] tracking-[-0.01em]">
            Who do you want <em className="text-[#8A6A45]">to be?</em>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#57534E]">
            Everything you do is shared across personas in this browser. Approve a vendor invoice as the property manager, then switch to the vendor to see the payout land.
          </p>
        </div>
        <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(PERSONAS) as PersonaId[]).map((p, i) => (
            <Link key={p} href={`/${p}`} className={`group block transition-transform duration-700 ${ease} hover:-translate-y-1 active:scale-[0.99]`}>
              <Bezel inner="flex min-h-64 flex-col p-7">
                <div className="flex items-start justify-between">
                  <span className="pt-2 text-[11px] font-medium tracking-[0.2em] tabular-nums text-[#8A6A45]">0{i + 1}</span>
                  <span className={`grid h-9 w-9 place-items-center rounded-full bg-[#1C1917]/5 transition-transform duration-500 ${ease} group-hover:translate-x-1 group-hover:-translate-y-[1px] group-hover:scale-105`}>
                    <Arrow className="h-4 w-4" />
                  </span>
                </div>
                <div className="mt-auto pt-10">
                  <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#78716C]">{PERSONAS[p].label}</div>
                  <h2 className="mt-2 font-serif text-3xl leading-tight">{names[p]}</h2>
                  <p className="mt-2 text-[14px] leading-relaxed text-[#57534E]">{PERSONAS[p].blurb}</p>
                </div>
              </Bezel>
            </Link>
          ))}
        </div>
        <p className="mt-12 text-center text-xs text-[#78716C]">Demo date: Oct 28, 2026. No real payments or messages are sent.</p>
      </div>
    </main>
  );
}
