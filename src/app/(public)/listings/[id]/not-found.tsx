import Link from "@/components/Link";
import { PublicFooter, PublicHeader } from "@/components/public/chrome";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto flex max-w-lg flex-col items-center gap-3 px-6 py-24 text-center">
        <h1 className="text-balance text-[22px] font-semibold">This home is no longer listed</h1>
        <p className="text-[15px] text-muted-foreground">It may have been leased or taken off the market. Similar homes are listed every week.</p>
        <Button asChild className="mt-2 h-10 px-4"><Link href="/listings">Search homes</Link></Button>
      </main>
      <PublicFooter />
    </>
  );
}
