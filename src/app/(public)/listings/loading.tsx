import { PublicHeader } from "@/components/public/chrome";

export default function Loading() {
  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-7xl space-y-6 px-4 pt-8 sm:px-6" aria-busy="true" aria-label="Loading homes">
        <div className="h-9 w-72 animate-pulse rounded-lg bg-muted" />
        <div className="h-56 animate-pulse rounded-2xl bg-muted" />
        <div className="h-11 animate-pulse rounded-lg bg-muted" />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="overflow-hidden rounded-xl border">
              <div className="aspect-[4/3] animate-pulse bg-muted" />
              <div className="space-y-2 p-4"><div className="h-5 w-24 animate-pulse rounded bg-muted" /><div className="h-4 w-40 animate-pulse rounded bg-muted" /><div className="h-4 w-32 animate-pulse rounded bg-muted" /></div>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
