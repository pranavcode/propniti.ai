import type { Metadata } from "next";
import Link from "next/link";
import { Arrow, Bezel, Eyebrow, ease } from "@/components/marketing/parts";
import { BackLinks, snapshotLabel } from "@/components/docs/parts";
import { DOCS, renderedDoc } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Docs · Propniti",
  description: "Propniti's product specification, solution architecture and prototype walkthrough.",
  robots: { index: false, follow: false },
};

export default function DocsIndex() {
  return (
    <div className="mx-auto max-w-6xl">
      <BackLinks />
      <div className="mt-10 max-w-3xl">
        <Eyebrow>Docs</Eyebrow>
        <h1 className="mt-6 font-serif text-[clamp(3rem,7vw,6rem)] leading-[0.95] tracking-[-0.01em]">
          How Propniti <em className="text-[#8A6A45]">works.</em>
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#57534E]">
          The working documents behind the prototype: what it does, how it is built, and a tour of every screen.
        </p>
        <p className="mt-4 text-xs text-[#78716C]">Snapshot of {snapshotLabel}</p>
      </div>
      <div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-3">
        {DOCS.map((d, i) => {
          const { toc, html } = renderedDoc(d.slug);
          const sections = toc.filter((t) => t.depth === 2).length;
          const images = (html.match(/<img /g) ?? []).length;
          return (
            <Link key={d.slug} href={`/docs/${d.slug}`} className={`group block transition-transform duration-700 ${ease} hover:-translate-y-1 active:scale-[0.99]`}>
              <Bezel className="h-full" inner="flex min-h-72 flex-col p-7">
                <div className="flex items-start justify-between">
                  <span className="pt-2 text-[11px] font-medium tracking-[0.2em] tabular-nums text-[#8A6A45]">0{i + 1}</span>
                  <span className={`grid h-9 w-9 place-items-center rounded-full bg-[#1C1917]/5 transition-transform duration-500 ${ease} group-hover:translate-x-1 group-hover:-translate-y-[1px] group-hover:scale-105`}>
                    <Arrow className="h-4 w-4" />
                  </span>
                </div>
                <h2 className="mt-auto pt-10 font-serif text-3xl leading-tight">{d.title}</h2>
                <p className="mt-2 text-[14px] leading-relaxed text-[#57534E]">{d.description}</p>
                <p className="mt-5 text-xs tabular-nums text-[#78716C]">
                  {sections} sections{images ? ` · ${images} ${d.slug === "walkthrough" ? "screenshots" : images === 1 ? "diagram" : "diagrams"}` : ""}
                </p>
              </Bezel>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
