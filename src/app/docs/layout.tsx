import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Nav } from "@/components/marketing/Nav";
import { SiteFooter } from "@/components/marketing/Footer";
import { DocsTheme } from "@/components/docs/Theme";

// Public but unlisted: never indexed, and not in any sitemap.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Docs use the app's tokens (data-surface="app": neutral greys, deep teal, Geist) so they read as the
// same product. Theme follows the app's pn_theme cookie; with no choice made, it follows the OS.
export default async function DocsLayout({ children }: LayoutProps<"/docs">) {
  const theme = (await cookies()).get("pn_theme")?.value;
  return (
    <div data-surface="app" data-docs className={`relative overflow-x-clip bg-background text-[15px] text-foreground antialiased ${theme === "dark" ? "dark" : ""}`}>
      <DocsTheme theme={theme === "light" || theme === "dark" ? theme : "system"} />
      <Nav />
      <main className="px-4 pb-24 pt-24 sm:px-6 sm:pt-28">{children}</main>
      <SiteFooter />
    </div>
  );
}
