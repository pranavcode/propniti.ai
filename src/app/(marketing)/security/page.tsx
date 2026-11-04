import type { Metadata } from "next";
import { Bot, Database, FileClock, KeyRound, Landmark, Lock } from "lucide-react";
import { BOOK_HREF, DEMO_HREF } from "@/components/marketing/content";
import { ButtonLink, Photo, SectionHead } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "Security · Propniti",
  description: "How Propniti controls money movement, AI actions, access and the audit trail.",
};

// Each control here is enforced in code; see AGENTS.md "Money rules", "AI rules" and "Security".
const CONTROLS = [
  {
    icon: Landmark, t: "Money moves only through guarded actions",
    points: [
      "Ledger tables can't be edited directly. Payments, payouts and fees go through actions that re-check balances and limits in the database.",
      "Every money action has an idempotency key, so a double click or a retry moves money once.",
      "Transfers and the audit log are append-only.",
    ],
  },
  {
    icon: Bot, t: "Agents propose; people approve",
    points: [
      "Agent tools that write can only create a proposal. Money moves after a person approves it, through the same guarded actions.",
      "Rule checks override a model's approval when they flag a problem.",
      "Model output is checked against a schema. Invoices, imports and messages are passed to the model as data, never as instructions.",
    ],
  },
  {
    icon: FileClock, t: "Everything is on the record",
    points: [
      "Each agent run saves every step: the tools it called, inputs and outputs, the model, tokens, cost and latency.",
      "Each approval records who decided, when and under which policy.",
      "Data Health fixes keep their before and after values.",
    ],
  },
  {
    icon: KeyRound, t: "Roles and scopes",
    points: [
      "Permissions are set per role and per module, from principal to vendor.",
      "Each person sees only the properties in their scope: a region, a set of properties, or their own records in a portal.",
      "Fields can be restricted to specific roles for both editing and creating.",
    ],
  },
  {
    icon: Database, t: "Separated data",
    points: [
      "Every table carries a workspace id, and every query filters on it.",
      "Queries can only name tables and columns that are registered, and all values are bound parameters.",
      "In the demo, each visitor gets a private copy of the sample portfolio that resets at midnight Pacific.",
    ],
  },
  {
    icon: Lock, t: "Request hygiene",
    points: [
      "Write requests must come from the same site and are rate limited.",
      "Request bodies are validated with size and count limits.",
      "Secrets live in the platform's secret store, never in code.",
    ],
  },
];

export default function Security() {
  return (
    <>
      <section aria-labelledby="sec-title" className="relative isolate overflow-hidden bg-(--mk-ink) px-4 pb-24 pt-32 text-(--mk-on-ink) sm:px-6 sm:pt-40">
        <div className="absolute inset-0 -z-10">
          <Photo src="/img/amenities/amenity-lobby.webp" alt="" priority />
          <div className="absolute inset-0 bg-(--mk-ink)/85" />
        </div>
        <div className="mx-auto max-w-7xl">
          <p className="text-[15px] font-medium text-(--mk-mint)">Security and trust</p>
          <h1 id="sec-title" className="mt-4 max-w-3xl text-balance text-[clamp(2.5rem,5.5vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white">Controls you can show an owner or an auditor.</h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-(--mk-on-ink-muted)">
            Property managers hold other people&apos;s money. These are the controls built into Propniti today. Each one is enforced by the software.
          </p>
        </div>
      </section>

      <section aria-labelledby="ctl-title" className="px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <SectionHead id="ctl-title" title="What's enforced" />
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-(--mk-line) md:grid-cols-2 lg:grid-cols-3">
            {CONTROLS.map(({ icon: Icon, t, points }) => (
              <section key={t} aria-label={t} className="bg-white p-7">
                <Icon aria-hidden className="size-5 text-(--mk-teal)" />
                <h2 className="mt-4 text-[19px] font-semibold tracking-[-0.01em]">{t}</h2>
                <ul className="mt-4 flex list-disc flex-col gap-2.5 pl-5 text-[15px] leading-relaxed text-(--mk-muted) marker:text-(--mk-teal)">
                  {points.map((p) => <li key={p}>{p}</li>)}
                </ul>
              </section>
            ))}
          </div>
          <div className="mt-14 flex flex-wrap items-center gap-3">
            <ButtonLink href={DEMO_HREF} arrow>See the audit trail in the demo</ButtonLink>
            <ButtonLink href={BOOK_HREF} tone="secondary">Book a demo</ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
