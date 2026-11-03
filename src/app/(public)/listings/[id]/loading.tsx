import { PublicHeader } from "@/components/public/chrome";

export default function Loading() {
  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-7xl space-y-6 px-4 pt-6 sm:px-6" aria-busy="true" aria-label="Loading home">
        <div className="aspect-[4/3] animate-pulse rounded-2xl bg-muted sm:aspect-auto sm:h-[460px]" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-3"><div className="h-8 w-3/4 animate-pulse rounded bg-muted" /><div className="h-5 w-1/2 animate-pulse rounded bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /></div>
          <div className="h-96 animate-pulse rounded-2xl bg-muted" />
        </div>
      </main>
    </>
  );
}
