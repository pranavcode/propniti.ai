import type { Metadata } from "next";
import { ArrowRight, BookOpen, Layers, MonitorPlay } from "lucide-react";
import Link from "@/components/Link";
import { Crumbs, snapshotLabel } from "@/components/docs/parts";
import { DOCS, renderedDoc } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Docs · Propniti",
  description: "Propniti's product specification, solution architecture and prototype walkthrough.",
  robots: { index: false, follow: false },
};

const ICONS = { spec: BookOpen, architecture: Layers, walkthrough: MonitorPlay } as const;

export default function DocsIndex() {
  return (
    <div className="mx-auto max-w-6xl">
      <Crumbs />
      <header className="mt-8 max-w-3xl">
        <p className="text-[15px] font-medium text-primary">Docs</p>
        <h1 className="mt-3 text-balance text-[clamp(2.25rem,5vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.035em]">How Propniti works</h1>
        <p className="mt-5 max-w-2xl text-pretty text-[17px] leading-relaxed text-muted-foreground">
          The product specification, how the system is built, and a step-by-step tour of every screen in the live demo.
        </p>
        <p className="mt-4 text-[13px] text-muted-foreground">Updated {snapshotLabel}</p>
      </header>
      <ul className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
        {DOCS.map((d) => {
          const { toc, html } = renderedDoc(d.slug);
          const sections = toc.filter((t) => t.depth === 2).length;
          const images = (html.match(/<img /g) ?? []).length;
          const Icon = ICONS[d.slug];
          return (
            <li key={d.slug}>
              <Link
                href={`/docs/${d.slug}`}
                className="group flex h-full flex-col rounded-xl border bg-card p-6 transition-[border-color,box-shadow] duration-200 hover:border-primary/40 hover:shadow-[0_8px_24px_-12px_rgb(0_0_0/0.18)] focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon aria-hidden className="size-[18px]" />
                </span>
                <h2 className="mt-6 text-[19px] font-semibold tracking-[-0.015em]">{d.title}</h2>
                <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted-foreground">{d.description}</p>
                <div className="mt-6 flex items-center justify-between text-[13px] text-muted-foreground">
                  <span className="tabular-nums">
                    {sections} sections{images ? ` · ${images} ${d.slug === "walkthrough" ? "screenshots" : images === 1 ? "diagram" : "diagrams"}` : ""}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-primary">
                    Read
                    <ArrowRight aria-hidden className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
