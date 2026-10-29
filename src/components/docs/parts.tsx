import Link from "next/link";
import { SNAPSHOT_DATE, type TocEntry } from "@/lib/docs";

export const snapshotLabel = new Date(`${SNAPSHOT_DATE}T00:00:00Z`).toLocaleDateString("en-US", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  year: "numeric",
});

export function BackLinks({ toIndex = false }: { toIndex?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[#57534E]">
      <Link href="/" className="hover:text-[#1C1917]">← Back to Propniti</Link>
      {toIndex && (
        <>
          <span aria-hidden className="h-1 w-1 rounded-full bg-[#A8A29E]" />
          <Link href="/docs" className="hover:text-[#1C1917]">All docs</Link>
        </>
      )}
    </div>
  );
}

function TocList({ toc }: { toc: TocEntry[] }) {
  return (
    <ol className="space-y-1 text-[13px] leading-snug">
      {toc.map((t) => (
        <li key={t.id} className={t.depth === 3 ? "pl-3" : ""}>
          <a
            href={`#${t.id}`}
            className={`block rounded-lg px-2 py-1 transition-colors hover:bg-[#1C1917]/[0.04] hover:text-[#1C1917] ${t.depth === 3 ? "text-[#78716C]" : "text-[#44403C]"}`}
          >
            {t.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

// Sticky list on wide screens; a collapsed disclosure above the text on narrow ones.
export function Toc({ toc }: { toc: TocEntry[] }) {
  return (
    <>
      <details className="group rounded-2xl bg-[#FFFDF8] ring-1 ring-[#1C1917]/[0.06] lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          On this page
          <span aria-hidden className="text-[#78716C] transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <nav aria-label="On this page" className="max-h-[60dvh] overflow-y-auto px-2 pb-3">
          <TocList toc={toc} />
        </nav>
      </details>
      <nav aria-label="On this page" className="sticky top-28 hidden max-h-[calc(100dvh-8rem)] overflow-y-auto pb-8 lg:block">
        <div className="mb-3 px-2 text-[10px] font-medium uppercase tracking-[0.2em] text-[#78716C]">On this page</div>
        <TocList toc={toc} />
      </nav>
    </>
  );
}
