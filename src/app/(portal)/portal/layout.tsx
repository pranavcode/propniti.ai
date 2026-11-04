import { SurfaceBody } from "@/components/app/SurfaceBody";
import { Toaster } from "@/components/ui/sonner";

// Same scoped app tokens as /app (globals.css [data-surface="app"]), without the staff shell.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="app" className="app min-h-screen">
      <SurfaceBody />
      {children}
      <Toaster />
    </div>
  );
}
