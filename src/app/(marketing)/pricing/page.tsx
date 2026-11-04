import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { BOOK_HREF, DEMO_HREF, PLANS } from "@/components/marketing/content";
import { ButtonLink, SectionHead } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "Pricing · Propniti",
  description: "Three plans priced per unit managed: Starter, Growth and Enterprise.",
};

// Plan × feature. Only features the demo shows are listed.
const ROWS: [string, [boolean, boolean, boolean]][] = [
  ["Properties, units, leases and residents", [true, true, true]],
  ["Receivables, payables and owner statements", [true, true, true]],
  ["Resident, owner and vendor portals", [true, true, true]],
  ["Public listings with online applications", [true, true, true]],
  ["Rule-based data checks", [true, true, true]],
  ["AI assistant with answers from your data", [false, true, true]],
  ["Eight agents with approval policies", [false, true, true]],
  ["Data Health fixes with before and after", [false, true, true]],
  ["Delinquency, renewal and compliance warnings", [false, true, true]],
  ["What-if rent and occupancy scenarios", [false, true, true]],
  ["Regional scopes and custom approval limits", [false, false, true]],
  ["Audit log export", [false, false, true]],
  ["Guided onboarding and data import support", [false, false, true]],
];

export default function Pricing() {
  return (
    <>
      <section aria-labelledby="pr-title" className="bg-(--mk-ink) px-4 pb-20 pt-32 text-(--mk-on-ink) sm:px-6 sm:pt-40">
        <div className="mx-auto max-w-7xl">
          <h1 id="pr-title" className="max-w-3xl text-balance text-[clamp(2.5rem,5.5vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white">Priced per unit you manage.</h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-(--mk-on-ink-muted)">
            Every plan includes the resident, owner and vendor portals. We quote after a short walkthrough, based on your unit count and the plan you choose.
          </p>
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.name} className={`flex flex-col rounded-2xl p-7 ${p.featured ? "bg-white text-(--mk-text)" : "bg-white/5 ring-1 ring-white/10"}`}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className={`text-[21px] font-semibold ${p.featured ? "" : "text-white"}`}>{p.name}</h2>
                  {p.featured && <span className="rounded-full bg-(--mk-teal-tint) px-2.5 py-0.5 text-[12px] font-medium text-(--mk-teal-deep)">Most operators start here</span>}
                </div>
                <p className={`mt-1.5 text-[15px] ${p.featured ? "text-(--mk-muted)" : ""}`}>{p.for}</p>
                <ul className="mt-6 flex flex-1 flex-col gap-2.5 text-[15px]">
                  {p.points.map((t) => (
                    <li key={t} className="flex gap-2.5"><Check aria-hidden className={`mt-1 size-4 shrink-0 ${p.featured ? "text-(--mk-teal)" : "text-(--mk-mint)"}`} />{t}</li>
                  ))}
                </ul>
                <ButtonLink href={BOOK_HREF} tone={p.featured ? "primary" : "outline-light"} className="mt-8 justify-center">Get a quote</ButtonLink>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="cmp-title" className="px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <SectionHead id="cmp-title" title="Compare plans" />
          <div className="mt-10 overflow-x-auto rounded-2xl bg-white ring-1 ring-(--mk-line)">
            <table className="w-full min-w-[640px] text-left text-[15px]">
              <thead>
                <tr className="border-b border-(--mk-line)">
                  <th scope="col" className="px-6 py-4 font-medium text-(--mk-muted)">Feature</th>
                  {PLANS.map((p) => <th key={p.name} scope="col" className="w-36 px-6 py-4 text-center font-semibold">{p.name}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-(--mk-line)">
                {ROWS.map(([f, has]) => (
                  <tr key={f}>
                    <th scope="row" className="px-6 py-3.5 font-normal">{f}</th>
                    {has.map((h, i) => (
                      <td key={i} className="px-6 py-3.5 text-center">
                        {h ? <Check aria-label="Included" className="mx-auto size-4 text-(--mk-teal)" /> : <Minus aria-label="Not included" className="mx-auto size-4 text-(--mk-line)" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-12 flex flex-wrap items-center gap-3">
            <ButtonLink href={DEMO_HREF} arrow>Try the live demo</ButtonLink>
            <ButtonLink href={BOOK_HREF} tone="secondary">Book a demo</ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
