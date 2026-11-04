import { cookies } from "next/headers";
import { SurfaceBody } from "@/components/app/SurfaceBody";
import { DocsTheme } from "@/components/docs/Theme";
import { Toaster } from "@/components/ui/sonner";
import { themeMode, themePreload } from "@/lib/theme";

// Same scoped app tokens as /app (globals.css [data-surface="app"]), without the staff shell. The
// theme is the staff app's (pn_theme cookie, else the OS), set before the first paint.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const mode = themeMode((await cookies()).get("pn_theme")?.value);
  return (
    <div data-surface="app" data-portal suppressHydrationWarning className={mode === "dark" ? "app dark min-h-screen" : "app min-h-screen"}>
      <script dangerouslySetInnerHTML={{ __html: themePreload(mode) }} />
      <SurfaceBody />
      <DocsTheme theme={mode} root="[data-portal]" />
      {children}
      <Toaster theme={mode} />
    </div>
  );
}
