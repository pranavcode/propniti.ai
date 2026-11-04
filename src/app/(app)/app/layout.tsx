import { Suspense } from "react";
import { cookies } from "next/headers";
import { currentSession, requireStaff } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { inboxCounts } from "@/extensions/inbox/data";
import { SurfaceBody } from "@/components/app/SurfaceBody";
import { AppShell } from "@/components/app/shell/AppShell";
import { shellData } from "@/components/app/shell/data";
import { AssistantDock } from "@/ai/ui/AssistantChat";
import { PeekDrawer } from "@/components/app/peek/PeekDrawer";

// Staff app frame (lane B): sidebar from the entity registry, top bar, ⌘K, "Viewing as" banner and
// the assistant dock, plus the record peek drawer every list opens (?peek=…). Keep the data-surface root and SurfaceBody (tokens in globals.css).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  const s = await currentSession();
  // The sidebar's Inbox badge: one grouped count; the nav renders without it if the count fails.
  const inbox = await inboxCounts({ db: getPlatform().db, ws: s.ws, actor: s.actor }).then((c) => c.needsYou, () => undefined);
  const data = await shellData(inbox ? { "/app/inbox": inbox } : {});
  const dark = (await cookies()).get("pn_theme")?.value === "dark";
  return (
    <div data-surface="app" className={dark ? "app dark" : "app"}>
      <SurfaceBody />
      <AppShell data={data} assistant={<AssistantDock />}>
        {children}
        <Suspense fallback={null}><PeekDrawer /></Suspense>
      </AppShell>
    </div>
  );
}
