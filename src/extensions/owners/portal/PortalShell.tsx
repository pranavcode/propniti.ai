import Link from "@/components/Link";
import { ArrowLeftRight } from "lucide-react";
import type { PortalRole } from "@/entities/types";
import { AppMark } from "@/components/app/shell/AppMark";
import { PersonAvatar } from "@/components/app/display";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { portalCtx, portalPersona } from "./context";
import { PortalNav } from "./ui/PortalNav";
import { PortalAssistant } from "./ui/PortalAssistant";
import { PortalTour } from "./ui/PortalTour";
import { toursFor } from "@/components/app/tour/registry";
import "../tours";

const LABEL: Record<PortalRole, string> = { owner: "Owner portal", resident: "Resident portal", vendor: "Vendor portal", applicant: "Applicant portal" };

// Frame for /portal/<role>: brand bar, sections (top on desktop, bottom tabs on phones), the
// signed-in person, and the AI help panel. A visitor signed in as someone else gets a one-click
// switch instead of the content.
export async function PortalShell({ role, brand, badges, children }: { role: PortalRole; brand?: string; badges?: Record<string, number>; children: React.ReactNode }) {
  const c = await portalCtx(role);
  const persona = portalPersona(role);
  return (
    <TooltipProvider delayDuration={200}>
    <div className="min-h-screen bg-muted/30 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-20 print:bg-white print:pb-0">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link href={persona.home} className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
            <AppMark size={28} />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[13.5px] font-semibold tracking-tight">{brand ?? "Summit Residential Partners"}</span>
              <span className="block truncate text-[11.5px] text-muted-foreground">{LABEL[role]}</span>
            </span>
          </Link>
          <div className="flex-1" />
          {c && <PortalNav role={role} badges={badges} />}
          <div className="flex items-center gap-2 pl-2">
            <PersonAvatar name={c?.persona.name ?? persona.name} size={30} />
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><Link href="/login"><ArrowLeftRight />Switch role</Link></Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-5 md:pt-7">
        {c ? children : (
          <div className="mx-auto mt-10 max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
            <PersonAvatar name={persona.name} size={48} className="mx-auto" />
            <h1 className="mt-3 text-[17px] font-semibold">This is {persona.name}&apos;s {LABEL[role].toLowerCase()}</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">You&apos;re signed in as someone else. Switch to {persona.name.split(" ")[0]} ({persona.title}) to see it.</p>
            <form action="/api/session" method="post" className="mt-4">
              <input type="hidden" name="persona" value={persona.id} />
              <input type="hidden" name="next" value={persona.home} />
              <Button type="submit" className="w-full">View as {persona.name}</Button>
            </form>
          </div>
        )}
      </main>
      {c && <PortalAssistant endpoint={`/portal/${role}/ask`} prompts={c.persona.assistantPrompts} />}
      {c && <PortalTour tours={toursFor(role)} />}
    </div>
    </TooltipProvider>
  );
}
