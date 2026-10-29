import type { Metadata } from "next";
import { Nav } from "@/components/marketing/Nav";
import { SiteFooter } from "@/components/marketing/Footer";

// Public but unlisted: never indexed, and not in any sitemap.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <div className="relative overflow-x-clip bg-[#F6F2EA] text-[#1C1917] selection:bg-[#1C1917] selection:text-[#F6F2EA]">
      <Nav />
      <main className="px-4 pb-28 pt-32 sm:pt-40">{children}</main>
      <SiteFooter className="rounded-t-[3rem] pt-6" />
    </div>
  );
}
