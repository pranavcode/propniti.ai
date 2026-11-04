import { Skeleton } from "@/components/ui/skeleton";

// Finance pages read the ledger on the server; this keeps the frame steady while they load.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 px-4 pt-5 md:px-6" aria-busy aria-label="Loading finance">
      <div className="flex flex-col gap-2"><Skeleton className="h-6 w-56" /><Skeleton className="h-3.5 w-96 max-w-full" /></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      <div className="grid gap-3 xl:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      <div className="space-y-1">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
    </div>
  );
}
