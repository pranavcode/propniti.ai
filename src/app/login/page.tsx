import type { Metadata } from "next";
import Link from "next/link";
import { PERSONAS, type Persona } from "@/auth/personas";
import { Wordmark } from "@/components/Logo";
import { Arrow, Bezel, Eyebrow, ease } from "@/components/marketing/parts";

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

const TINT = ["bg-[#E7DCCB]", "bg-[#DCE5DF]", "bg-[#E3DCE8]", "bg-[#E8DED6]", "bg-[#DDE3EA]"];
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("");

function PersonaCard({ p, i, next }: { p: Persona; i: number; next?: string }) {
  return (
    <form action="/api/session" method="post" className="h-full">
      <input type="hidden" name="persona" value={p.id} />
      {next && <input type="hidden" name="next" value={next} />}
      <button type="submit" aria-label={`Continue as ${p.name}, ${p.title}`} className={`group block h-full w-full text-left transition-transform duration-500 ${ease} hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1917] focus-visible:ring-offset-4 focus-visible:ring-offset-[#F6F2EA] rounded-[1.75rem] active:scale-[0.99]`}>
        <Bezel className="h-full" inner="flex h-full flex-col p-5">
          <div className="flex items-start gap-3">
            <span aria-hidden className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-semibold text-[#1C1917] ${TINT[i % TINT.length]}`}>{initials(p.name)}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">{p.name}</div>
              <div className="truncate text-[13px] text-[#57534E]">{p.title}</div>
            </div>
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1C1917]/5 transition-transform duration-500 ${ease} group-hover:translate-x-0.5 group-hover:-translate-y-[1px]`}>
              <Arrow className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-full bg-[#1C1917] px-2 py-0.5 font-medium text-[#FBF9F4]">{p.role.replace(/_/g, " ")}</span>
            <span className="rounded-full bg-[#1C1917]/[0.05] px-2 py-0.5 text-[#44403C]">{p.scope.label}</span>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-[#57534E]">{SEES[p.id]}</p>
        </Bezel>
      </button>
    </form>
  );
}

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const staff = PERSONAS.filter((p) => !p.portal);
  const portals = PERSONAS.filter((p) => p.portal);
  return (
    <main className="min-h-[100dvh] bg-[#F6F2EA] px-4 pb-20 pt-8 text-[#1C1917] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Propniti home"><Wordmark size={32} text="text-3xl" /></Link>
          <Link href="/" className="rounded-full px-4 py-2 text-[13px] text-[#44403C] ring-1 ring-[#1C1917]/10 hover:bg-white/60">Back to site</Link>
        </div>
        <div className="mt-14 max-w-3xl">
          <Eyebrow>Live demo · sample portfolio · no password</Eyebrow>
          <h1 className="mt-5 font-serif text-[clamp(2.5rem,6vw,4.75rem)] leading-[0.95] tracking-[-0.01em]">
            Sign in as <em className="text-[#8A6A45]">anyone.</em>
          </h1>
          <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-[#57534E]">
            Pick a person to see Propniti through their role and scope: 30 properties, 18 months of history and the AI agents working alongside them. Switch any time from your avatar menu.
          </p>
        </div>

        <section aria-labelledby="staff" className="mt-12">
          <h2 id="staff" className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#78716C]">Your company · {staff.length} roles</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {staff.map((p, i) => <PersonaCard key={p.id} p={p} i={i} next={next} />)}
          </div>
        </section>

        <section aria-labelledby="portals" className="mt-12">
          <h2 id="portals" className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#78716C]">Portals · owners, residents, vendors and applicants</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {portals.map((p, i) => <PersonaCard key={p.id} p={p} i={i + staff.length} />)}
          </div>
        </section>

        <p className="mt-12 text-center text-xs text-[#78716C]">Sample data with fictional names. Your changes are private to you and reset at midnight. No real payments or messages are sent.</p>
      </div>
    </main>
  );
}
