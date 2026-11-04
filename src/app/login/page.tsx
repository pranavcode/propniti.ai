/* eslint-disable @next/next/no-img-element -- image optimisation is off on Workers; files are pre-sized webp */
import type { Metadata } from "next";
import Link from "@/components/Link";
import { ArrowLeft, ArrowRight, Lock } from "lucide-react";
import { PERSONAS, type Persona } from "@/auth/personas";
import { Wordmark } from "@/components/Logo";
import { MK_VARS } from "@/components/marketing/ui";

export const metadata: Metadata = { title: "Sign in · Propniti demo" };

// Demo sign-in: every persona is a one-click card. Picking one posts to /api/session, which sets
// the pn_as cookie and lands on that persona's home. No passwords; a plain form post, so it works
// before any JavaScript loads.

const SEES: Record<string, string> = {
  daniel: "Portfolio NOI against budget, occupancy and collections across all 30 properties, and approvals over limit.",
  priya: "Her 14 Texas properties side by side, concessions waiting on her, and work orders running past SLA.",
  marcus: "Today's queue for 3 Austin communities: late rent, expiring leases, vendor invoices and what the agents already handled.",
  lena: "The leasing pipeline: new prospects, today's tours, available units and follow-ups the Leasing agent drafted.",
  rachel: "Applications to decide with the screening summary and reasons, leases to sign and owner agreements.",
  grace: "Bills to approve with anomaly flags, trust reconciliation, vendor bank changes and owner statements.",
  tom: "The work-order board by SLA, make-ready turns, preventive maintenance and vendor insurance expiries.",
  sam: "Users, roles and the permission matrix, approval limits, state rules and the audit log.",
  nadia: "Every customer org, AI usage across them and data-health scores.",
  owner: "Owner portal: distributions, NOI and occupancy, repairs over the approval limit and statements.",
  resident: "Resident portal: rent due and autopay, maintenance requests and the lease.",
  vendor: "Vendor portal: assigned jobs, invoices and payments, and insurance status.",
  applicant: "Applicant portal: what's left to finish the application, documents and the fee.",
};

// Avatar tones from the brand palette: teal and its neighbours, light fill with dark text.
const TONES = [
  "bg-[oklch(0.92_0.04_192)] text-[oklch(0.34_0.07_198)]",
  "bg-[oklch(0.92_0.035_225)] text-[oklch(0.36_0.07_235)]",
  "bg-[oklch(0.93_0.04_165)] text-[oklch(0.36_0.07_165)]",
  "bg-[oklch(0.93_0.04_80)] text-[oklch(0.4_0.07_70)]",
];
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("");
const roleLabel = (p: Persona) => p.role.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) + (p.portal ? " portal" : "");

function PersonaCard({ p, i, next }: { p: Persona; i: number; next?: string }) {
  return (
    <form action="/api/session" method="post" className="h-full">
      <input type="hidden" name="persona" value={p.id} />
      {next && <input type="hidden" name="next" value={next} />}
      <button
        type="submit"
        aria-label={`Continue as ${p.name}, ${p.title}`}
        className="group flex h-full w-full flex-col rounded-xl bg-white p-5 text-left ring-1 ring-(--mk-line) transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md hover:ring-(--mk-teal)/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mk-teal) active:translate-y-0"
      >
        <div className="flex items-center gap-3">
          <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-full text-[14px] font-semibold ${TONES[i % TONES.length]}`}>{initials(p.name)}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{p.name}</div>
            <div className="truncate text-[13px] text-(--mk-muted)">{p.title}</div>
          </div>
          <ArrowRight aria-hidden className="size-4 shrink-0 text-(--mk-muted) transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-(--mk-teal)" />
        </div>
        <div className="mt-3.5 flex flex-wrap gap-1.5 text-[12px]">
          <span className="rounded-md bg-(--mk-teal-tint) px-2 py-0.5 font-medium text-(--mk-teal-deep)">{roleLabel(p)}</span>
          <span className="rounded-md bg-(--mk-bg-2) px-2 py-0.5 text-(--mk-muted)">{p.scope.label}</span>
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-(--mk-muted)">{SEES[p.id]}</p>
      </button>
    </form>
  );
}

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const staff = PERSONAS.filter((p) => !p.portal);
  const portals = PERSONAS.filter((p) => p.portal);
  return (
    <div style={MK_VARS} className="min-h-[100dvh] bg-(--mk-bg) font-sans text-(--mk-text) antialiased">
      <header className="relative isolate overflow-hidden bg-(--mk-ink) text-(--mk-on-ink)">
        <img src="/img/marketing/hero-community.webp" alt="" className="absolute inset-0 -z-10 h-full w-full object-cover object-[center_40%]" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,oklch(0.2_0.03_208/0.85),oklch(0.2_0.03_208/0.95))]" />
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
          <div className="flex items-center justify-between text-white">
            <Link href="/" aria-label="Propniti home"><Wordmark size={28} /></Link>
            <Link href="/" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] text-(--mk-on-ink-muted) hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
              <ArrowLeft aria-hidden className="size-4" /> Back to site
            </Link>
          </div>
          <div className="mt-14 max-w-3xl">
            <h1 className="text-balance text-[clamp(2.25rem,5vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white">Choose who to sign in as.</h1>
            <p className="mt-5 max-w-2xl text-pretty text-[17px] leading-relaxed text-(--mk-on-ink-muted)">
              Each person sees Propniti through their own role and scope: 30 properties, 18 months of history and the agents working alongside them. Switch role any time from your avatar menu in the top bar.
            </p>
            <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] text-white">
              <Lock aria-hidden className="size-3.5 text-(--mk-mint)" />
              Private demo data, resets at midnight Pacific. No password needed.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <section aria-labelledby="staff" className="pt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="staff" className="text-[20px] font-semibold tracking-[-0.01em]">Staff</h2>
            <p className="text-[14px] text-(--mk-muted)">{staff.length} roles inside a property management company</p>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {staff.map((p, i) => <PersonaCard key={p.id} p={p} i={i} next={next} />)}
          </div>
        </section>

        <section aria-labelledby="portals" className="pt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="portals" className="text-[20px] font-semibold tracking-[-0.01em]">Portals</h2>
            <p className="text-[14px] text-(--mk-muted)">Owners, residents, vendors and applicants see only their own records</p>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {portals.map((p, i) => <PersonaCard key={p.id} p={p} i={i + staff.length} />)}
          </div>
        </section>

        <p className="mt-14 text-center text-[13px] text-(--mk-muted)">Fictional names and companies. No real payments or messages are sent.</p>
      </main>
    </div>
  );
}
