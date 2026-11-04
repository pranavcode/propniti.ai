import { Skeleton } from "@/components/ui/skeleton";

// The inbox's two panes while conversations load.
export default function Loading() {
  return (
    <main className="flex h-[calc(100dvh-3rem)] flex-col" aria-busy aria-label="Loading messages">
      <div className="border-b px-4 py-3 md:px-6"><Skeleton className="h-6 w-40" /><Skeleton className="mt-2 h-3.5 w-80" /></div>
      <div className="grid flex-1 grid-cols-1 md:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 border-r p-3">{["a", "b", "c", "d", "e", "f", "g"].map((k) => <div key={k} className="flex flex-col gap-1.5"><Skeleton className="h-3.5 w-1/2" /><Skeleton className="h-3 w-4/5" /></div>)}</div>
        <div className="hidden flex flex-col gap-3 p-4 md:block"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-16 w-2/3" /><Skeleton className="ml-auto h-16 w-1/2" /></div>
      </div>
    </main>
  );
}
