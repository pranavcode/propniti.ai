import Link from "@/components/Link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DOCS, SNAPSHOT_DATE, type TocEntry } from "@/lib/docs";
import { TocList } from "./TocList";

export const snapshotLabel = new Date(`${SNAPSHOT_DATE}T00:00:00Z`).toLocaleDateString("en-US", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  year: "numeric",
});

export function Crumbs({ title }: { title?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
      <Link href="/" className="hover:text-foreground">Propniti</Link>
      <ChevronRight aria-hidden className="size-3.5 opacity-60" />
      {title ? <Link href="/docs" className="hover:text-foreground">Docs</Link> : <span aria-current="page" className="text-foreground">Docs</span>}
      {title && (
        <>
          <ChevronRight aria-hidden className="size-3.5 opacity-60" />
          <span aria-current="page" className="text-foreground">{title}</span>
        </>
      )}
    </nav>
  );
}

function DocList({ current }: { current: string }) {
  return (
    <ul className="space-y-0.5 text-[13px]">
      {DOCS.map((d) => (
        <li key={d.slug}>
          <Link
            href={`/docs/${d.slug}`}
            aria-current={d.slug === current ? "page" : undefined}
            className="block rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-[current=page]:bg-primary/10 aria-[current=page]:font-medium aria-[current=page]:text-primary"
          >
            {d.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const label = "mb-2 px-2 text-[12px] font-medium text-muted-foreground";

// Desktop: a sticky column with the doc switcher and this page's sections. Phone and tablet: one
// collapsed disclosure above the text.
export function Sidebar({ current, toc }: { current: string; toc: TocEntry[] }) {
  return (
    <>
      <details className="group rounded-lg border bg-card lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] font-medium [&::-webkit-details-marker]:hidden">
          On this page
          <ChevronDown aria-hidden className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <nav aria-label="On this page" className="max-h-[60dvh] overflow-y-auto border-t px-2 py-3">
          <TocList toc={toc} />
        </nav>
      </details>
      <div className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] overflow-y-auto pb-8 pr-2 lg:block">
        <nav aria-label="Docs">
          <div className={label}>Docs</div>
          <DocList current={current} />
        </nav>
        <nav aria-label="On this page" className="mt-8 border-t pt-6">
          <div className={label}>On this page</div>
          <TocList toc={toc} spy />
        </nav>
      </div>
    </>
  );
}
