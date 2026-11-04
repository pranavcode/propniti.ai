import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Nav } from "@/components/marketing/Nav";
import { SiteFooter } from "@/components/marketing/Footer";
import { DocsTheme } from "@/components/docs/Theme";
import { ThemePreload } from "@/components/app/ThemePreload";
import { themeMode } from "@/lib/theme";

// Public but unlisted: never indexed, and not in any sitemap.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Docs use the app's tokens (data-surface="app": neutral greys, deep teal, Geist) so they read as the
// same product. Theme follows the app's pn_theme cookie; with no choice made, it follows the OS.
export default async function DocsLayout({ children }: LayoutProps<"/docs">) {
  const mode = themeMode((await cookies()).get("pn_theme")?.value);
  // The surface and theme are set before the first paint, so the page doesn't draw once in the
  // marketing colours or light and then switch.
  return (
    <div data-surface="app" data-docs suppressHydrationWarning className={`relative overflow-x-clip bg-background text-[15px] text-foreground antialiased ${mode === "dark" ? "dark" : ""}`}>
      <ThemePreload mode={mode} />
      <DocsTheme theme={mode} />
      <Nav />
      <main className="px-4 pb-24 pt-24 sm:px-6 sm:pt-28">{children}</main>
      <SiteFooter />
    </div>
  );
}
