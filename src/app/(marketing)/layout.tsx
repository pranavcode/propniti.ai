import { Nav } from "@/components/marketing/Nav";
import { SiteFooter } from "@/components/marketing/Footer";
import { MK_VARS } from "@/components/marketing/ui";

// Marketing surface: the app's deep teal and Geist, with richer photography and type scale.
// Tokens are local CSS variables so nothing leaks into the app or docs surfaces.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={MK_VARS} className="relative overflow-x-clip bg-(--mk-bg) font-sans text-(--mk-text) antialiased selection:bg-(--mk-teal) selection:text-white">
      <Nav overDark />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
