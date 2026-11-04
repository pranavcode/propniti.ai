import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { Crumbs, Sidebar, snapshotLabel } from "@/components/docs/parts";
import { DocLightbox } from "@/components/docs/Lightbox";
import { DOCS, getDoc, renderedDoc } from "@/lib/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: PageProps<"/docs/[slug]">): Promise<Metadata> {
  const doc = getDoc((await params).slug);
  if (!doc) return {};
  return { title: `${doc.title} · Propniti docs`, description: doc.description, robots: { index: false, follow: false } };
}

export default async function DocPage({ params }: PageProps<"/docs/[slug]">) {
  const doc = getDoc((await params).slug);
  if (!doc) notFound();
  const { html, toc } = renderedDoc(doc.slug);
  const others = DOCS.filter((d) => d.slug !== doc.slug);

  return (
    <div className="mx-auto grid max-w-[62rem] grid-cols-1 gap-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-x-16 lg:gap-y-10">
      <aside className="min-w-0 lg:row-span-2 lg:pt-1">
        <Sidebar current={doc.slug} toc={toc} />
      </aside>
      <header className="order-first min-w-0 max-w-[70ch] lg:order-none">
        <Crumbs title={doc.title} />
        <h1 className="mt-6 text-balance text-[clamp(2rem,4.5vw,3rem)] font-semibold leading-[1.08] tracking-[-0.035em]">{doc.title}</h1>
        <p className="mt-4 text-pretty text-[17px] leading-relaxed text-muted-foreground">{doc.description}</p>
        <p className="mt-4 text-[13px] text-muted-foreground">Updated {snapshotLabel}</p>
      </header>
      <div className="min-w-0 max-w-[70ch]">
        <article className="doc-prose border-t pt-2" dangerouslySetInnerHTML={{ __html: html }} />
        <nav aria-label="Other docs" className="mt-16 grid grid-cols-1 gap-3 border-t pt-8 sm:grid-cols-2">
          {others.map((d) => (
            <Link key={d.slug} href={`/docs/${d.slug}`} className="group rounded-lg border bg-card p-4 transition-colors hover:border-primary/40">
              <div className="text-[12px] text-muted-foreground">Also read</div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[15px] font-medium">
                {d.title}
                <ArrowRight aria-hidden className="size-4 shrink-0 text-primary transition-transform duration-200 group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}
        </nav>
      </div>
      <DocLightbox />
    </div>
  );
}
