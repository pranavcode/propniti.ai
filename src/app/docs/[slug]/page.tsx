import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Eyebrow } from "@/components/marketing/parts";
import { BackLinks, Toc, snapshotLabel } from "@/components/docs/parts";
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
    <div className="mx-auto max-w-6xl">
      <BackLinks toIndex />
      <header className="mt-10 max-w-3xl">
        <Eyebrow>Docs</Eyebrow>
        <h1 className="mt-6 font-serif text-[clamp(2.75rem,6vw,5rem)] leading-[0.98] tracking-[-0.01em]">{doc.title}</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[#57534E]">{doc.description}</p>
        <p className="mt-4 text-xs text-[#78716C]">Snapshot of {snapshotLabel}</p>
      </header>

      <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
        <aside className="min-w-0">
          <Toc toc={toc} />
        </aside>
        <div className="min-w-0 max-w-[46rem]">
          <article className="doc-prose" dangerouslySetInnerHTML={{ __html: html }} />
          <nav aria-label="Other docs" className="mt-20 grid grid-cols-1 gap-4 border-t border-[#1C1917]/10 pt-10 sm:grid-cols-2">
            {others.map((d) => (
              <Link key={d.slug} href={`/docs/${d.slug}`} className="group rounded-2xl bg-[#FFFDF8] p-5 ring-1 ring-[#1C1917]/[0.06] transition-colors hover:bg-white">
                <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#78716C]">Also read</div>
                <div className="mt-2 font-serif text-2xl leading-tight">{d.title}</div>
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <DocLightbox />
    </div>
  );
}
