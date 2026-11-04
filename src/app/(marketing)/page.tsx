import type { Metadata } from "next";
import Link from "@/components/Link";
import { ArrowRight, Check, FileClock, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { AGENTS, BOOK_HREF, DEMO_HREF, FAQ, INTEGRATIONS, PERSONAS_MKT, PILLARS, PLANS } from "@/components/marketing/content";
import { PersonaTabs } from "@/components/marketing/PersonaTabs";
import { loadProof } from "@/components/marketing/proof";
import { Rise } from "@/components/marketing/Rise";
import { ButtonLink, Photo, SampleTag, SectionHead, Shot } from "@/components/marketing/ui";
import { PillarVignette } from "@/components/marketing/Vignettes";

export const metadata: Metadata = {
  title: "Propniti: know your portfolio is right",
  description: "Property management software for multifamily and commercial operators. Propniti checks the data behind your rent roll, ledger and owner statements, explains every number, and has agents do the routine work while you approve money and legal decisions.",
};

const fmt = (n: number) => n.toLocaleString("en-US");

// Pillar photos: one property per pillar, from different metros.
const PILLAR_PHOTOS: Record<string, string> = {
  "data-health": "/img/props/p08.webp",
  explained: "/img/props/p17.webp",
  predictions: "/img/props/p22.webp",
  "what-if": "/img/props/p24.webp",
};

export default async function Home() {
  const proof = await loadProof();
  const stats: [string, string][] = [
    [fmt(proof.properties), "properties"],
    [fmt(proof.units), "units and suites"],
    [String(proof.metros), "metros: Austin, Dallas, Atlanta, Phoenix"],
    ...(proof.months ? [[String(proof.months), "months of ledger history"] as [string, string]] : []),
    ...(proof.issues ? [[fmt(proof.issues), "data issues found and explained"] as [string, string]] : []),
    ...(proof.hoursSaved ? [[fmt(proof.hoursSaved), "staff hours handled by agents"] as [string, string]] : []),
  ];

  return (
    <>
      {/* Hero: product screenshot over property photography */}
      <section aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-(--mk-ink) text-(--mk-on-ink)">
        <div className="absolute inset-0 -z-10">
          <Photo src="/img/marketing/hero-community.webp" alt="" priority className="object-[center_40%]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,oklch(0.2_0.03_208/0.82)_0%,oklch(0.2_0.03_208/0.7)_45%,oklch(0.2_0.03_208/0.96)_88%)]" />
        </div>
        <div className="mx-auto max-w-7xl px-4 pt-32 sm:px-6 sm:pt-40">
          <div className="max-w-3xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700">
            <p className="text-[15px] font-medium text-(--mk-mint)">For multifamily and commercial operators, owners and asset managers</p>
            <h1 id="hero-title" className="mt-5 text-balance text-[clamp(2.75rem,7vw,5.5rem)] font-semibold leading-[0.98] tracking-[-0.035em] text-white">
              Know your portfolio is right.
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-[clamp(1.0625rem,1.6vw,1.25rem)] leading-relaxed text-(--mk-on-ink-muted)">
              Propniti checks the data behind your rent roll, ledger and owner statements, explains every number, and warns you before problems reach an owner. Eight agents handle the routine work, and you approve every money and legal decision.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <ButtonLink href={DEMO_HREF} tone="light" arrow>Try the live demo</ButtonLink>
              <ButtonLink href={BOOK_HREF} tone="outline-light">Book a demo</ButtonLink>
            </div>
            <p className="mt-4 text-[14px] text-(--mk-on-ink-muted)">Pick a role and you&apos;re in. No sign-up, and the data is fictional.</p>
          </div>

          <div className="relative mt-14 sm:mt-20 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-6 motion-safe:duration-1000">
            <Shot src="/img/marketing/shots/home.webp" alt="Propniti home for a property manager: what the agents handled since yesterday, approvals waiting with their reasons, and risks to look at" priority className="rounded-b-none" />
            <div aria-hidden className="pointer-events-none absolute -left-6 top-[46%] hidden w-80 lg:block motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-4 motion-safe:delay-500 motion-safe:duration-700 motion-safe:fill-mode-both">
              <PillarVignette slug="data-health" />
            </div>
          </div>
        </div>
      </section>

      {/* Proof strip */}
      <section aria-labelledby="proof-title" className="border-b border-(--mk-line) bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="proof-title" className="text-[15px] font-medium">The demo portfolio</h2>
            <SampleTag>Sample data, generated for the demo</SampleTag>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
            {stats.map(([v, l]) => (
              <div key={l} className="border-l border-(--mk-line) pl-4">
                <dt className="sr-only">{l}</dt>
                <dd className="text-[clamp(1.75rem,3vw,2.25rem)] font-semibold tabular-nums tracking-[-0.02em]">{v}</dd>
                <dd className="mt-1 text-[14px] leading-snug text-(--mk-muted)">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* The four pillars */}
      <section id="product" aria-labelledby="product-title" className="scroll-mt-16 px-4 py-24 sm:px-6 sm:py-32">
        <div className="mx-auto max-w-7xl">
          <SectionHead
            id="product-title"
            title="Four ways to check your portfolio yourself."
            lede="Whether the data is right, what drove each number, what's likely to go wrong next, and what changes if you move rent. Each check runs on the same records you work from."
          />
          <div className="mt-20 flex flex-col gap-28 sm:gap-36">
            {PILLARS.map((p, i) => (
              <article key={p.slug} aria-labelledby={`pillar-${p.slug}`} className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
                <Rise className={`lg:col-span-5 ${i % 2 ? "lg:order-2" : ""}`}>
                  <p className="text-[15px] font-medium text-(--mk-teal)">{p.name}</p>
                  <h3 id={`pillar-${p.slug}`} className="mt-3 text-balance text-[clamp(1.625rem,2.8vw,2.375rem)] font-semibold leading-[1.1] tracking-[-0.025em]">{p.title}</h3>
                  <p className="mt-5 text-pretty text-[17px] leading-relaxed text-(--mk-muted)">{p.body}</p>
                  <ul className="mt-6 flex flex-col gap-3 text-[15px]">
                    {p.points.map((t) => (
                      <li key={t} className="flex gap-3"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-(--mk-teal)" />{t}</li>
                    ))}
                  </ul>
                  <Link href={`/product/${p.slug}`} className="mt-8 inline-flex items-center gap-1.5 text-[15px] font-medium text-(--mk-teal) hover:underline">
                    More about {p.name.toLowerCase()} <ArrowRight aria-hidden className="size-4" />
                  </Link>
                </Rise>
                <Rise delay={120} className={`lg:col-span-7 ${i % 2 ? "lg:order-1" : ""}`}>
                  <div className="relative">
                    <div className="relative overflow-hidden rounded-2xl p-4 sm:p-8">
                      <div className="absolute inset-0 -z-0">
                        <Photo src={PILLAR_PHOTOS[p.slug]} alt="" sizes="(min-width: 1024px) 58vw, 100vw" />
                        <div className="absolute inset-0 bg-(--mk-ink)/25" />
                      </div>
                      <Shot src={p.shot} alt={p.shotAlt} className="relative" />
                    </div>
                    <div className={`pointer-events-none absolute -bottom-8 hidden w-[22rem] sm:block ${i % 2 ? "-left-4" : "-right-4"}`}>
                      <PillarVignette slug={p.slug} />
                    </div>
                  </div>
                </Rise>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Agents */}
      <section id="agents" aria-labelledby="agents-title" className="scroll-mt-16 bg-(--mk-ink) px-4 py-24 text-(--mk-on-ink) sm:px-6 sm:py-32">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-6">
              <SectionHead
                dark
                id="agents-title"
                title="Meet your agents."
                lede="Eight agents watch the portfolio on a schedule and when events happen. Each one looks things up with the same data you see, proposes an action with its reasons, and stops at the approval limits you set."
              />
              <p className="mt-8 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[15px] font-medium text-white">
                <ShieldCheck aria-hidden className="size-4 text-(--mk-mint)" />
                You approve money and legal decisions.
              </p>
            </div>
            <Rise className="lg:col-span-6">
              <Shot src="/img/marketing/shots/agents.webp" alt="Agents page: a card for each agent with status, schedule, proposals and autonomy level" />
            </Rise>
          </div>

          <ul className="mt-16 grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            {AGENTS.map((a) => (
              <li key={a.name} className="flex flex-col bg-(--mk-ink) p-6">
                <h3 className="text-[17px] font-semibold text-white">{a.name}</h3>
                <p className="mt-2 flex-1 text-[15px] leading-relaxed text-(--mk-on-ink-muted)">{a.job}</p>
                <p className="mt-5 text-[13px] text-(--mk-mint)">You approve: {a.approves.toLowerCase()}</p>
              </li>
            ))}
          </ul>
          <div className="mt-10">
            <ButtonLink href="/product/agents" tone="outline-light" arrow>How the agents work</ButtonLink>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section id="who" aria-labelledby="who-title" className="scroll-mt-16 px-4 py-24 sm:px-6 sm:py-32">
        <div className="mx-auto max-w-7xl">
          <SectionHead id="who-title" title="One system for everyone who touches a property." lede="Staff, owners, residents and vendors each get their own view of the same records, limited to what they're allowed to see." />
          <div className="mt-12">
            <PersonaTabs personas={PERSONAS_MKT} />
          </div>
        </div>
      </section>

      {/* Security and trust */}
      <section id="trust" aria-labelledby="trust-title" className="scroll-mt-16 bg-(--mk-bg-2) px-4 py-24 sm:px-6 sm:py-32">
        <div className="mx-auto max-w-7xl">
          <SectionHead id="trust-title" title="Built for the people who sign off." lede="Operators answer to owners, lenders and auditors. Every action in Propniti, by a person or an agent, leaves a record you can show them." />
          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {[
              { icon: SlidersHorizontal, t: "Approvals with your limits", b: "Approval policies set who can approve what, by amount and risk. Above a limit, an agent can only propose.", rows: [["Bill over $1,500", "Accountant or principal"], ["Repair over owner limit", "Owner"], ["Late fee", "Within the state cap"]] },
              { icon: FileClock, t: "A complete audit trail", b: "Who did what, when and why, for people and agents alike. Each agent run keeps its step-by-step trace: what it looked up and what it proposed.", rows: [["10:12", "Grace Kim approved bill INV-88213"], ["10:09", "Payables agent held vendor payment"], ["09:58", "Data Health fixed rent on L-p01-0412"]] },
              { icon: ShieldCheck, t: "Data controls", b: "Roles and scopes limit each person to their properties and modules. Ledger tables change only through guarded actions, never by direct edit.", rows: [["Regional manager", "Texas, 14 properties"], ["Owner", "Own entities only"], ["Ledger", "Actions only"]] },
            ].map(({ icon: Icon, t, b, rows }, i) => (
              <Rise key={t} delay={i * 80} className="flex flex-col rounded-2xl bg-white p-7 ring-1 ring-(--mk-line)">
                <Icon aria-hidden className="size-5 text-(--mk-teal)" />
                <h3 className="mt-4 text-[19px] font-semibold tracking-[-0.01em]">{t}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-(--mk-muted)">{b}</p>
                <dl className="mt-6 divide-y divide-(--mk-line) border-t border-(--mk-line) text-[13px]">
                  {rows.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 py-2.5">
                      <dt className="text-(--mk-muted)">{k}</dt>
                      <dd className="text-right font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Rise>
            ))}
          </div>
          <Link href="/security" className="mt-10 inline-flex items-center gap-1.5 text-[15px] font-medium text-(--mk-teal) hover:underline">
            Read how security works <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
      </section>

      {/* Integrations */}
      <section aria-labelledby="int-title" className="px-4 py-24 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <h2 id="int-title" className="text-balance text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.1] tracking-[-0.03em]">Connects to banks, payment processors and listing sites.</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-(--mk-muted)">In the demo these connections are simulated. Payments, bank feeds and syndication run against sample data.</p>
            <div className="mt-5"><SampleTag>Simulated in the demo</SampleTag></div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:col-span-8">
            {INTEGRATIONS.map((x) => (
              <li key={x.name} className="flex items-center gap-4 rounded-xl bg-white px-5 py-4 ring-1 ring-(--mk-line)">
                <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-(--mk-bg-2) text-[13px] font-semibold text-(--mk-teal)">{x.name.slice(0, 2)}</span>
                <span>
                  <span className="block text-[15px] font-medium">{x.name}</span>
                  <span className="block text-[13px] text-(--mk-muted)">{x.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Pricing teaser */}
      <section aria-labelledby="price-title" className="border-t border-(--mk-line) bg-white px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHead id="price-title" title="Priced per unit you manage." lede="Three plans. We quote after a walkthrough of your portfolio, so the price reflects your unit count and the modules you use." />
            <ButtonLink href="/pricing" tone="secondary" arrow>Compare plans</ButtonLink>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.name} className={`rounded-2xl p-7 ${p.featured ? "bg-(--mk-ink) text-(--mk-on-ink)" : "bg-(--mk-bg) ring-1 ring-(--mk-line)"}`}>
                <h3 className={`text-[19px] font-semibold ${p.featured ? "text-white" : ""}`}>{p.name}</h3>
                <p className={`mt-1 text-[14px] ${p.featured ? "text-(--mk-on-ink-muted)" : "text-(--mk-muted)"}`}>{p.for}</p>
                <ul className="mt-6 flex flex-col gap-2.5 text-[14px]">
                  {p.points.map((t) => (
                    <li key={t} className="flex gap-2.5"><Check aria-hidden className={`mt-0.5 size-4 shrink-0 ${p.featured ? "text-(--mk-mint)" : "text-(--mk-teal)"}`} />{t}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq-title" className="px-4 py-24 sm:px-6 sm:py-32">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-12">
          <h2 id="faq-title" className="text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.1] tracking-[-0.03em] lg:col-span-4">Questions operators ask</h2>
          <div className="divide-y divide-(--mk-line) border-y border-(--mk-line) lg:col-span-8">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] font-medium [&::-webkit-details-marker]:hidden">
                  {q}
                  <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-(--mk-bg-2) text-(--mk-teal) transition-transform duration-200 group-open:rotate-45">+</span>
                </summary>
                <p className="max-w-2xl pb-6 text-[15px] leading-relaxed text-(--mk-muted)">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing */}
      <section aria-labelledby="cta-title" className="relative isolate overflow-hidden bg-(--mk-ink) px-4 py-28 text-center sm:px-6 sm:py-36">
        <div className="absolute inset-0 -z-10">
          <Photo src="/img/marketing/hero-skyline.webp" alt="" />
          <div className="absolute inset-0 bg-(--mk-ink)/80" />
        </div>
        <h2 id="cta-title" className="mx-auto max-w-3xl text-balance text-[clamp(2.25rem,5vw,4rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white">See it on a portfolio of 30 properties.</h2>
        <p className="mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-(--mk-on-ink-muted)">Sign in as a principal, property manager, accountant, owner, resident or vendor and look around. Nothing you change leaves your copy of the data.</p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <ButtonLink href={DEMO_HREF} tone="light" arrow>Try the live demo</ButtonLink>
          <ButtonLink href={BOOK_HREF} tone="outline-light">Book a demo</ButtonLink>
        </div>
      </section>
    </>
  );
}
