import type { Metadata } from "next";
import { Check } from "lucide-react";
import { DEMO_HREF } from "@/components/marketing/content";
import { DemoRequest } from "@/components/marketing/DemoRequest";
import { ButtonLink, Photo } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "Book a demo · Propniti",
  description: "A 30-minute walkthrough of Propniti on a sample portfolio, focused on your properties and workflows.",
};

const AGENDA = [
  "Data Health on a 30-property portfolio: issues found, the fixes proposed, and the audit trail behind them",
  "An agent run from trigger to approval, with every step it took",
  "Your workflows: the roles, approval limits and reports you use today",
];

export default function BookDemo() {
  return (
    <section aria-labelledby="bd-title" className="px-4 pb-24 pt-28 sm:px-6 sm:pt-36">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h1 id="bd-title" className="text-balance text-[clamp(2.25rem,4.5vw,3.5rem)] font-semibold leading-[1.04] tracking-[-0.035em]">Book a 30-minute walkthrough.</h1>
          <p className="mt-5 text-[17px] leading-relaxed text-(--mk-muted)">We&apos;ll run the product on a sample portfolio and spend most of the time on how you work today.</p>
          <ul className="mt-8 flex flex-col gap-3.5 text-[15px]">
            {AGENDA.map((t) => <li key={t} className="flex gap-3"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-(--mk-teal)" />{t}</li>)}
          </ul>
          <div className="mt-10 overflow-hidden rounded-2xl">
            <div className="aspect-[16/10]"><Photo src="/img/marketing/hero-leasing.webp" alt="A leasing manager meeting clients in a bright office" sizes="(min-width: 1024px) 40vw, 100vw" /></div>
          </div>
        </div>
        <div className="lg:col-span-7">
          <DemoRequest />
          <div className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl bg-(--mk-bg-2) p-6">
            <p className="flex-1 text-[15px]">Prefer to look around first? The live demo opens straight into the product.</p>
            <ButtonLink href={DEMO_HREF} tone="secondary" arrow>Try the live demo</ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}
