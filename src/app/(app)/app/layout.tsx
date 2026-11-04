import { Suspense } from "react";
import { cookies } from "next/headers";
import { requireStaff } from "@/auth/session";
import { sessionInboxCounts } from "@/extensions/inbox/server";
import { SurfaceBody } from "@/components/app/SurfaceBody";
import { AppShell } from "@/components/app/shell/AppShell";
import { shellData } from "@/components/app/shell/data";
import { AssistantDock } from "@/ai/ui/AssistantChat";
import { PeekDrawer } from "@/components/app/peek/PeekDrawer";
import { themeMode, themePreload } from "@/lib/theme";

// Staff app frame (lane B): sidebar from the entity registry, top bar, ⌘K, "Viewing as" banner and
// the assistant dock, plus the record peek drawer every list opens (?peek=…). Keep the data-surface root and SurfaceBody (tokens in globals.css).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  // The sidebar's Inbox badge (cached; see src/extensions/inbox/counts.ts). The nav renders without
  // it if the count fails.
  const [data, inbox] = await Promise.all([shellData(), sessionInboxCounts().then((c) => c.needsYou, () => undefined)]);
  if (inbox) for (const g of data.nav) for (const i of g.items) if (i.href === "/app/inbox") i.count = inbox;
  const mode = themeMode((await cookies()).get("pn_theme")?.value);
  return (
    <div data-surface="app" suppressHydrationWarning className={mode === "dark" ? "app dark" : "app"}>
      <script dangerouslySetInnerHTML={{ __html: themePreload(mode) }} />
      <SurfaceBody />
      <AppShell data={data} assistant={<AssistantDock />}>
        {children}
        <Suspense fallback={null}><PeekDrawer /></Suspense>
      </AppShell>
    </div>
  );
}
