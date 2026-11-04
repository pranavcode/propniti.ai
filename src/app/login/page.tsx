import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DEMO_PASSWORD, demoEmail, getPersona, PERSONAS, PN_AS, safeNext, type Persona } from "@/auth/personas";
import { SignIn, type Card } from "./SignIn";

export const metadata: Metadata = { title: "Sign in · Propniti demo" };

// Demo sign-in: an email and password form (one published password for every demo person) beside
// a compact one-click people list. Both post to /api/session, which checks the password, sets the pn_as
// cookie and lands on that persona's home (or a safe `next`). Plain form posts, so both work
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

const roleLabel = (p: Persona) => p.role.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) + (p.portal ? " portal" : "");
const ERRORS = { email: "No demo account with that email — pick a person from the list.", password: "Wrong password — the demo password is shown above." } as const;

type Params = Partial<Record<"next" | "as" | "error" | "email" | "switch", string | string[]>>;
// A repeated query param (?email=a&email=b) arrives as an array: use the first value.
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Login({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  const sp = { next: first(raw.next), as: first(raw.as), error: first(raw.error), email: first(raw.email), switch: first(raw.switch) };
  const next = safeNext(sp.next);
  const as = getPersona(sp.as);
  const field = sp.error === "email" || sp.error === "password" ? sp.error : undefined;
  const signedIn = getPersona((await cookies()).get(PN_AS)?.value);
  const cards: Card[] = PERSONAS.map((p) => ({ id: p.id, name: p.name, title: p.title, role: roleLabel(p), scope: p.scope.label, sees: SEES[p.id] ?? "", email: demoEmail(p.id), portal: !!p.portal }));
  return (
    <SignIn
      cards={cards}
      next={next}
      initialEmail={as ? demoEmail(as.id) : (sp.email ?? "").slice(0, 254)}
      initialPassword={as ? DEMO_PASSWORD : ""}
      error={field && { field, message: ERRORS[field] }}
      current={signedIn && !as && !field && sp.switch !== "1" ? { id: signedIn.id, name: signedIn.name, title: signedIn.title, scope: signedIn.scope.label, href: next ?? signedIn.home } : undefined}
      preselected={!!as || !!field}
    />
  );
}
