import { notFound } from "next/navigation";
import Link from "@/components/Link";
import { ArrowRight } from "lucide-react";
import { PageBody, PageHeader } from "@/components/app/page";
import { HELP_ARTICLES } from "@/seed/help";
import { MORE_HELP_ARTICLES } from "@/seed/help-more";

// One product help article, opened from a definition's "Learn more" and the assistant's citations.
const ARTICLES = [...HELP_ARTICLES, ...MORE_HELP_ARTICLES];
const find = (slug: string) => ARTICLES.find((a) => a.id === slug);

export async function generateMetadata({ params }: PageProps<"/app/help/[slug]">) {
  const a = find((await params).slug);
  return { title: `${a?.title ?? "Help"} · Propniti` };
}

// The bodies are the seed's own light markdown: paragraphs, numbered or dashed lists and **bold**.
function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/).map((part, i) => part.startsWith("**") ? <b key={i} className="font-semibold">{part.slice(2, -2)}</b> : part)}</>;
}

function Body({ body }: { body: string }) {
  return (
    <div className="flex max-w-3xl flex-col gap-3 text-[13.5px] leading-relaxed">
      {body.split(/\n\s*\n/).map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (lines.every((l) => /^\d+\.\s/.test(l))) return <ol key={i} className="flex list-decimal flex-col gap-1.5 pl-5">{lines.map((l, j) => <li key={j}><Inline text={l.replace(/^\d+\.\s/, "")} /></li>)}</ol>;
        if (lines.every((l) => /^[-*]\s/.test(l))) return <ul key={i} className="flex list-disc flex-col gap-1.5 pl-5">{lines.map((l, j) => <li key={j}><Inline text={l.replace(/^[-*]\s/, "")} /></li>)}</ul>;
        return <p key={i}><Inline text={lines.join(" ")} /></p>;
      })}
    </div>
  );
}

export default async function HelpArticlePage({ params }: PageProps<"/app/help/[slug]">) {
  const a = find((await params).slug);
  if (!a) notFound();
  return (
    <main>
      <PageHeader title={a.title} meta={a.tags.length ? <span>{a.tags.join(" · ")}</span> : undefined} />
      <PageBody>
        <Body body={a.body} />
        {a.route && <Link href={a.route} className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-primary hover:underline">Go to the page <ArrowRight className="size-3.5" /></Link>}
      </PageBody>
    </main>
  );
}
