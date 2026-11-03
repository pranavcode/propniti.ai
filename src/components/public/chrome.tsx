import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { cn } from "@/lib/utils";
import { METROS } from "./catalog";

// Header, footer and small shared atoms for the renter-facing site.

export function PublicHeader() {
  return (
    <>
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow">Skip to content</a>
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/listings" className="flex items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <LogoMark size={26} />
          <span className="text-[15px]">Propniti <span className="font-normal text-muted-foreground">Rentals</span></span>
        </Link>
        <nav aria-label="Metros" className="hidden items-center gap-1 md:flex">
          {METROS.map((m) => (
            <Link key={m} href={`/listings?metro=${m}`} className="rounded-md px-2.5 py-1.5 text-[13.5px] text-muted-foreground hover:bg-muted hover:text-foreground">{m}</Link>
          ))}
        </nav>
        <Link href="/" className="ml-auto text-[13.5px] text-muted-foreground hover:text-foreground">For property managers</Link>
      </div>
    </header>
    </>
  );
}

export function PublicFooter() {
  return (
    <footer className="mt-16 border-t bg-muted/40">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 text-[13px] text-muted-foreground sm:px-6 md:grid-cols-[1fr_auto]">
        <div className="max-w-2xl space-y-2">
          <p className="flex items-center gap-2 font-medium text-foreground"><EqualHousing /> Equal Housing Opportunity</p>
          <p>We follow the Fair Housing Act and state and local fair housing laws. Every home is open to everyone on equal terms. Ask us for a reasonable accommodation at any time.</p>
          <p>Demo site with sample data: homes, prices and people are fictional. Tours and applications you submit stay in your private demo workspace and reset at midnight.</p>
        </div>
        <div className="flex flex-col gap-1.5 md:text-right">
          <Link href="/listings" className="hover:text-foreground">Search homes</Link>
          <Link href="/login" className="hover:text-foreground">Staff sign-in</Link>
          <span>No tracking scripts. No ads.</span>
        </div>
      </div>
    </footer>
  );
}

function EqualHousing() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M3 11 12 4l9 7" />
      <path d="M5 10v10h14V10" />
      <path d="M9 13h6M9 16h6" />
    </svg>
  );
}

export function Pill({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "success" | "warning" | "ai" | "info"; className?: string }) {
  const tones = {
    neutral: "bg-muted text-foreground/80",
    success: "bg-tone-success/10 text-tone-success",
    warning: "bg-tone-warning/12 text-tone-warning",
    ai: "bg-tone-ai/10 text-tone-ai",
    info: "bg-tone-info/10 text-tone-info",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export function availableText(on: string | null, today: string) {
  if (!on || on <= today) return "Available now";
  return `Available ${new Date(`${on}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}
