import { Skeleton } from "@/components/ui/skeleton";

// The inbox header, filter tabs and rows while items load.
export default function Loading() {
  return (
    <main className="flex flex-col gap-4 px-4 pt-5 md:px-6" aria-busy aria-label="Loading inbox">
      <div className="flex items-start gap-3">
        <Skeleton className="size-8 rounded-md" />
        <div className="flex flex-col gap-2"><Skeleton className="h-5 w-32" /><Skeleton className="h-3.5 w-96 max-w-full" /></div>
      </div>
      <div className="flex gap-2 border-b pb-2">{["a", "b", "c", "d"].map((k) => <Skeleton key={k} className="h-6 w-20" />)}</div>
      <div className="divide-y rounded-lg border bg-card">
        {["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => (
          <div key={k} className="flex items-start gap-3 px-4 py-3">
            <Skeleton className="size-7 rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-3.5 w-1/2" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-1/4" /></div>
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
    </main>
  );
}
