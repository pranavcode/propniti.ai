import { SurfaceBody } from "@/components/app/SurfaceBody";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

// App shell placeholder. Lane B replaces the body with the AppShell (sidebar, top bar, ⌘K,
// "Viewing as" banner, copilot panel); keep the data-surface root and SurfaceBody.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="app" className="app min-h-screen">
      <SurfaceBody />
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster />
    </div>
  );
}
