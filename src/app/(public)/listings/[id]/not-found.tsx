import Link from "next/link";
import { PublicFooter, PublicHeader } from "@/components/public/chrome";

export default function NotFound() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-24 text-center">
        <h1 className="text-balance text-[22px] font-semibold">This home is no longer listed</h1>
        <p className="text-[15px] text-muted-foreground">It may have been leased or taken off the market. Similar homes are listed every week.</p>
        <Link href="/listings" className="mt-2 inline-flex h-10 items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90">Search homes</Link>
      </main>
      <PublicFooter />
    </>
  );
}
