/* eslint-disable @next/next/no-img-element -- static screenshots; image optimisation is off on Workers */
import { Nav } from "@/components/marketing/Nav";
import { Reveal } from "@/components/marketing/Reveal";
import { Bezel, Eyebrow, PillLink } from "@/components/marketing/parts";

const grain =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const ticker = [
  "Rent reminder sent to Riverside Lofts #110 by SMS",
  "Invoice WO-1041 matches PO-5521 · 97% confidence",
  "Lease renewal offer sent to Riverside Lofts #204",
  "WO-1042 flagged: $275 over PO, 1 photo missing",
  "6 November rent invoices generated",
  "Quarterly HVAC service scheduled at Harbor View",
  "Vendor payout of $635 approved and sent by ACH",
];

const steps = [
  ["Bring your portfolio", "Add properties, tenancies and vendors in one guided pass, or import them from AppFolio or Buildium."],
  ["Agents keep watch", "Every 15 minutes the agent sweeps rent, leases, invoices and work orders, and acts on what it finds."],
  ["You approve what matters", "Routine work runs itself. Anything that moves money waits for your one tap."],
];

const people = [
  ["Property managers", "Alerts, approvals and the whole portfolio on one screen."],
  ["Owners", "Occupancy, rent and payouts for their own buildings."],
  ["Tenants", "Rent, invoices and repair requests from their phone."],
  ["Maintenance", "Jobs with time estimates, status and photo proof."],
  ["Vendors", "Work orders, invoices against the PO, payouts and 1099s."],
];

const trust = [
  ["A confidence score on every decision", "Each result shows how sure the agent is and the evidence behind it. Below the bar, a person decides."],
  ["A human approves every payment", "The agent prepares payouts and waits. It never moves money on its own."],
  ["Card and bank data never touch us", "Payments run through Stripe and Plaid. We keep tokens, not numbers."],
  ["Every action on the record", "People and agents alike: who did what, when and why, kept for seven years."],
];

export default function Landing() {
  return (
    <div className="relative overflow-x-clip bg-[#F6F2EA] text-[#1C1917] selection:bg-[#1C1917] selection:text-[#F6F2EA]">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-40 opacity-[0.035] mix-blend-multiply" style={{ backgroundImage: grain }} />
      <Nav />

      {/* Hero */}
      <section className="relative px-4 pb-24 pt-36 sm:pt-44">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-24 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(180,140,90,0.18),transparent)]" />
        <div className="relative mx-auto max-w-6xl text-center">
          <Reveal>
            <Eyebrow>
              <span className="h-1.5 w-1.5 rounded-full bg-[#7C8B6A]" /> AI property operations<span className="hidden sm:inline"> · US multifamily &amp; commercial</span>
            </Eyebrow>
          </Reveal>
          <Reveal delay={120}>
            <h1 className="mx-auto mt-8 max-w-5xl font-serif text-[clamp(3.25rem,9vw,8.5rem)] leading-[0.92] tracking-[-0.02em]">
              Buildings that <em className="text-[#8A6A45]">run themselves.</em>
            </h1>
          </Reveal>
          <Reveal delay={240}>
            <p className="mx-auto mt-8 max-w-xl text-lg leading-relaxed text-[#57534E]">
              Propniti&apos;s agents chase rent, check every vendor invoice against its purchase order and keep each lease on track. You approve what matters.
            </p>
          </Reveal>
          <Reveal delay={360}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <PillLink href="/demo">Try the live demo</PillLink>
              <PillLink href="/signup" dark={false}>Get started</PillLink>
            </div>
            <p className="mt-4 text-xs text-[#78716C]">Runs on sample data. No sign-up needed.</p>
          </Reveal>
        </div>

        <Reveal delay={200} className="relative mx-auto mt-20 max-w-6xl">
          <Bezel className="rounded-[2.5rem] md:[transform:perspective(2000px)_rotateX(6deg)]" inner="rounded-[calc(2.5rem-0.375rem)]">
            <img src="/marketing/dashboard.png" alt="Propniti property manager dashboard: portfolio stats, alerts with quick actions and agent activity" className="w-full" />
          </Bezel>
          <div className="pointer-events-none absolute -left-6 top-[18%] hidden w-72 -rotate-2 md:block">
            <Bezel inner="p-4">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-[#78716C]">Agent · invoice check <span className="text-[#5F7A4E]">97%</span></div>
              <div className="mt-2 text-sm font-medium">WO-1041 matches PO-5521</div>
              <div className="mt-3 h-1.5 rounded-full bg-[#1C1917]/5"><div className="h-1.5 w-[97%] rounded-full bg-[#5F7A4E]" /></div>
            </Bezel>
          </div>
          <div className="pointer-events-none absolute -right-6 bottom-[14%] hidden w-72 rotate-[2.5deg] md:block">
            <Bezel inner="p-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[#78716C]">SMS · to Jasmine, #204</div>
              <div className="mt-2 rounded-2xl rounded-bl-md bg-[#1C1917] px-3 py-2 text-[13px] leading-snug text-[#FBF9F4]">
                Your lease ends Dec 12. Renew for 12 months at $1,850? Reply YES.
              </div>
            </Bezel>
          </div>
        </Reveal>
      </section>

      {/* Ticker */}
      <div className="border-y border-[#1C1917]/[0.07] bg-[#FBF9F4]/60 py-5">
        <div className="flex w-max animate-[marquee_60s_linear_infinite] gap-12 whitespace-nowrap text-sm text-[#57534E] motion-reduce:animate-none">
          {[...ticker, ...ticker].map((t, i) => (
            <span key={i} className="flex items-center gap-12">
              {t}
              <span className="h-1 w-1 rounded-full bg-[#8A6A45]" />
            </span>
          ))}
        </div>
      </div>

      {/* Product bento */}
      <section id="product" className="px-4 py-28 sm:py-40">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <Eyebrow>The product</Eyebrow>
            <h2 className="mt-6 max-w-3xl font-serif text-5xl leading-[1] tracking-[-0.01em] sm:text-7xl">
              The busywork, handled. <em className="text-[#8A6A45]">The decisions, yours.</em>
            </h2>
          </Reveal>

          <div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-12">
            <Reveal className="md:col-span-8 md:row-span-2">
              <Bezel inner="flex flex-col">
                <div className="p-8 sm:p-10">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-[#78716C]">Vendor work orders</div>
                  <h3 className="mt-3 max-w-md font-serif text-4xl leading-tight">Every invoice checked against its purchase order.</h3>
                  <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[#57534E]">Line items, totals and job photos, compared before anyone pays. Clean invoices take one tap; problems arrive with the evidence.</p>
                </div>
                <div className="mt-auto translate-x-8 overflow-hidden rounded-tl-2xl ring-1 ring-[#1C1917]/[0.06] sm:translate-x-10">
                  <img src="/marketing/validation.png" alt="Invoice WO-1041 validated: all line items and photos match the PO at 97% confidence" className="w-full" />
                </div>
              </Bezel>
            </Reveal>

            <Reveal delay={120} className="md:col-span-4">
              <Bezel inner="p-8">
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#78716C]">Confidence</div>
                <div className="mt-4 font-sans text-7xl font-medium leading-none tracking-[-0.05em] tabular-nums">97<span className="text-3xl text-[#78716C]">%</span></div>
                <div className="mt-5 h-1.5 rounded-full bg-[#1C1917]/5"><div className="h-1.5 w-[97%] rounded-full bg-[#5F7A4E]" /></div>
                <ul className="mt-5 space-y-1.5 text-[13px] text-[#57534E]">
                  <li>✓ Total $635 matches PO</li>
                  <li>✓ 2 of 2 photos provided</li>
                  <li className="text-[#A4502F]">✗ Below 85%? A person decides.</li>
                </ul>
              </Bezel>
            </Reveal>

            <Reveal delay={200} className="md:col-span-4">
              <Bezel inner="p-8">
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#78716C]">Nudges</div>
                <h3 className="mt-3 font-serif text-3xl leading-tight">On the channel they actually answer.</h3>
                <div className="mt-5 flex flex-wrap gap-2 text-[12px]">
                  {["SMS", "WhatsApp", "Email", "Voice"].map((c) => (
                    <span key={c} className="rounded-full bg-[#1C1917]/[0.04] px-3 py-1 ring-1 ring-[#1C1917]/[0.06]">{c}</span>
                  ))}
                </div>
              </Bezel>
            </Reveal>

            <Reveal className="md:col-span-7">
              <Bezel inner="flex h-full flex-col">
                <div className="p-8 sm:p-10">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-[#78716C]">Assistant</div>
                  <h3 className="mt-3 font-serif text-4xl leading-tight">&ldquo;Who&apos;s late on rent?&rdquo;</h3>
                  <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[#57534E]">Answers from your own data, with the next actions the agent can take for you.</p>
                </div>
                <div className="mx-8 mt-auto overflow-hidden rounded-t-2xl ring-1 ring-[#1C1917]/[0.06] sm:mx-10">
                  <img src="/marketing/assistant.png" alt="Assistant listing overdue tenants and suggesting reminders" className="w-full" />
                </div>
              </Bezel>
            </Reveal>

            <Reveal delay={120} className="md:col-span-5">
              <Bezel inner="p-8 sm:p-10">
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#78716C]">Audit trail</div>
                <h3 className="mt-3 font-serif text-3xl leading-tight">Every action, on the record.</h3>
                <ol className="mt-6 space-y-4 border-l border-[#1C1917]/10 pl-5 text-[13px]">
                  {[
                    ["08:45", "Agent", "Swept portfolio: 2 overdue, 2 renewals, 2 invoices"],
                    ["09:00", "Agent", "Rent reminder to Marcus Lee by SMS"],
                    ["10:12", "Maya Patel", "Approved WO-1041 · $635 by ACH"],
                    ["10:13", "Agent", "Payout confirmation sent to CoolAir HVAC"],
                  ].map(([t, a, d]) => (
                    <li key={t} className="relative">
                      <span className="absolute -left-[23px] top-1.5 h-1.5 w-1.5 rounded-full bg-[#8A6A45]" />
                      <div className="text-[#78716C]">{t} · {a}</div>
                      <div>{d}</div>
                    </li>
                  ))}
                </ol>
              </Bezel>
            </Reveal>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="px-4 pb-28 sm:pb-40">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <Eyebrow>How it works</Eyebrow>
          </Reveal>
          <div className="mt-10 divide-y divide-[#1C1917]/10 border-y border-[#1C1917]/10">
            {steps.map(([t, b], i) => (
              <Reveal key={t} delay={i * 100}>
                <div className="group grid grid-cols-1 items-baseline gap-4 py-10 md:grid-cols-12">
                  <div className={`text-[11px] font-medium tracking-[0.2em] tabular-nums text-[#8A6A45] md:col-span-2 md:pt-3`}>0{i + 1}</div>
                  <h3 className="font-serif text-4xl leading-tight md:col-span-4">{t}</h3>
                  <p className="text-[15px] leading-relaxed text-[#57534E] md:col-span-5 md:col-start-8">{b}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Who */}
      <section id="who" className="pb-28 sm:pb-40">
        <div className="mx-auto max-w-6xl px-4">
          <Reveal>
            <Eyebrow>Who it&apos;s for</Eyebrow>
            <h2 className="mt-6 max-w-3xl font-serif text-5xl leading-[1] sm:text-7xl">Everyone in the building, <em className="text-[#8A6A45]">one platform.</em></h2>
          </Reveal>
        </div>
        <Reveal delay={150}>
          <div className="mt-14 flex snap-x gap-5 overflow-x-auto pb-4 [scrollbar-width:none]" style={{ paddingInline: "max(1rem, calc((100vw - 72rem) / 2 + 1rem))", scrollPaddingInline: "max(1rem, calc((100vw - 72rem) / 2 + 1rem))" }}>
            {people.map(([t, b], i) => (
              <Bezel key={t} className="w-72 shrink-0 snap-start" inner="flex min-h-64 flex-col p-7">
                <div className="text-[11px] font-medium tracking-[0.2em] tabular-nums text-[#8A6A45]">0{i + 1}</div>
                <h3 className="mt-auto font-serif text-3xl">{t}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[#57534E]">{b}</p>
              </Bezel>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Trust */}
      <section id="trust" className="rounded-t-[3rem] bg-[#1C1917] px-4 py-28 text-[#F6F2EA] sm:py-40">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <Eyebrow light>Trust</Eyebrow>
            <h2 className="mt-6 max-w-3xl font-serif text-5xl leading-[1] sm:text-7xl">Agents you can hand <em className="text-[#D6B88F]">the keys to.</em></h2>
          </Reveal>
          <div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-2">
            {trust.map(([t, b], i) => (
              <Reveal key={t} delay={(i % 2) * 120}>
                <Bezel dark inner="p-8 sm:p-10">
                  <h3 className="font-serif text-3xl leading-tight">{t}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-[#A8A29E]">{b}</p>
                </Bezel>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="bg-[#1C1917] px-4 pb-28 text-center text-[#F6F2EA] sm:pb-40">
        <Reveal>
          <h2 className="mx-auto max-w-4xl font-serif text-[clamp(3rem,8vw,7rem)] leading-[0.95]">
            Watch the agent <em className="text-[#D6B88F]">work.</em>
          </h2>
          <p className="mx-auto mt-6 max-w-md text-[#A8A29E]">Sign in as a manager, owner, tenant, vendor or maintenance tech on a sample portfolio.</p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <PillLink href="/demo" dark={false}>Try the live demo</PillLink>
          </div>
        </Reveal>
      </section>

      <footer className="bg-[#1C1917] px-4 pb-10 text-[#A8A29E]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end gap-6 border-t border-white/10 pt-10 text-sm">
          <div>
            <div className="font-serif text-4xl text-[#F6F2EA]">Propniti</div>
            <div className="mt-2">AI property operations for US portfolios.</div>
          </div>
          <div className="ml-auto flex gap-6">
            <a href="/login" className="hover:text-[#F6F2EA]">Sign in</a>
            <a href="/signup" className="hover:text-[#F6F2EA]">Get started</a>
            <a href="/demo" className="hover:text-[#F6F2EA]">Demo</a>
          </div>
          <div className="w-full text-xs text-[#78716C]">© 2026 Propniti</div>
        </div>
      </footer>
    </div>
  );
}
