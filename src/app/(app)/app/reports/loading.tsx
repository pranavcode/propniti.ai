import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 px-4 pt-5 md:px-6" aria-busy="true" aria-label="Loading report">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-9 w-full max-w-3xl" />
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-3 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
