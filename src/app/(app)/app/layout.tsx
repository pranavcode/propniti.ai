import { cookies } from "next/headers";
import { SurfaceBody } from "@/components/app/SurfaceBody";
import { AppShell } from "@/components/app/shell/AppShell";
import { shellData } from "@/components/app/shell/data";
import { AssistantDock } from "@/ai/ui/AssistantChat";

// Staff app frame (lane B): sidebar from the entity registry, top bar, ⌘K, "Viewing as" banner and
// the assistant dock. Keep the data-surface root and SurfaceBody (tokens in globals.css).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const data = await shellData();
  const dark = (await cookies()).get("pn_theme")?.value === "dark";
  return (
    <div data-surface="app" className={dark ? "app dark" : "app"}>
      <SurfaceBody />
      <AppShell data={data} assistant={<AssistantDock />}>{children}</AppShell>
    </div>
  );
}
