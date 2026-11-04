import type { Metadata } from "next";
import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { AGENTS, BOOK_HREF, DEMO_HREF, PILLARS } from "@/components/marketing/content";
import { Rise } from "@/components/marketing/Rise";
import { ButtonLink, Photo, SectionHead, Shot } from "@/components/marketing/ui";
import { PillarVignette } from "@/components/marketing/Vignettes";

const PHOTOS: Record<string, string> = {
  "data-health": "/img/props/p08.webp",
  explained: "/img/props/p17.webp",
  predictions: "/img/props/p22.webp",
  "what-if": "/img/props/p24.webp",
  agents: "/img/props/p15.webp",
};

// A run, in the order the orchestrator executes it (src/ai/orchestrator.ts).
const RUN_STEPS = [
  ["Something triggers it", "A schedule, an event such as a failed payment or a new work order, a person pressing Run now, or a question in the assistant."],
  ["It looks things up", "The agent calls the same read tools the app uses: records, the ledger, metrics, policies and open data issues. Each call is logged."],
  ["It proposes", "Every proposal carries its reasons, a confidence score and the run it came from. Nothing changes yet."],
  ["A person decides", "Approval policies decide what needs whom. Money and legal actions always wait for a person; low-risk work can apply on its own if you allow it."],
  ["It's on the record", "The approval, the action and the full step trace stay in the audit log."],
];

const AUTONOMY = [
  ["Suggest", "The agent only suggests. People do the work."],
  ["Approve", "The agent prepares each action, and a person approves it."],
  ["Auto within policy", "The agent acts on its own below your limits. Anything above a limit, and anything that moves money, goes to a person."],
];

type Props = { params: Promise<{ module: string }> };

export function generateStaticParams() {
  return [...PILLARS.map((p) => ({ module: p.slug })), { module: "agents" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { module } = await params;
  if (module === "agents") return { title: "Agents · Propniti", description: "Eight agents that look things up, propose actions with reasons, and stop at your approval limits." };
  const p = PILLARS.find((x) => x.slug === module);
  return p ? { title: `${p.name} · Propniti`, description: p.title } : {};
}

export default async function ProductPage({ params }: Props) {
  const { module } = await params;
  const pillar = PILLARS.find((x) => x.slug === module);
  if (!pillar && module !== "agents") notFound();

  const name = pillar?.name ?? "Agents";
  const title = pillar?.title ?? "Agents that do the routine work and stop where you say.";
  const body = pillar?.body ?? "Eight agents watch the portfolio on a schedule and when events happen. Each one proposes actions with its reasons and a confidence score, and every money or legal action waits for a person.";
  const shot = pillar?.shot ?? "/img/marketing/shots/agents.webp";
  const shotAlt = pillar?.shotAlt ?? "Agents page: a card for each agent with status, schedule, proposals and autonomy level";
  const others = PILLARS.filter((x) => x.slug !== module);

  return (
    <>
      <section aria-labelledby="p-title" className="relative isolate overflow-hidden bg-(--mk-ink) text-(--mk-on-ink)">
        <div className="absolute inset-0 -z-10">
          <Photo src={PHOTOS[module]} alt="" priority />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,oklch(0.2_0.03_208/0.88)_0%,oklch(0.2_0.03_208/0.8)_50%,oklch(0.2_0.03_208/0.97)_90%)]" />
        </div>
        <div className="mx-auto grid max-w-7xl items-end gap-12 px-4 pb-0 pt-32 sm:px-6 sm:pt-40 lg:grid-cols-12">
          <div className="pb-4 lg:col-span-5 lg:pb-24">
            <p className="text-[15px] font-medium text-(--mk-mint)">{name}</p>
            <h1 id="p-title" className="mt-4 text-balance text-[clamp(2.25rem,4.6vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-white">{title}</h1>
            <p className="mt-6 text-pretty text-[17px] leading-relaxed text-(--mk-on-ink-muted)">{body}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={DEMO_HREF} tone="light" arrow>Try it in the demo</ButtonLink>
              <ButtonLink href={BOOK_HREF} tone="outline-light">Book a demo</ButtonLink>
            </div>
          </div>
          <div className="relative lg:col-span-7">
            <Shot src={shot} alt={shotAlt} priority className="rounded-b-none" />
            {pillar && (
              <div className="pointer-events-none absolute -left-6 bottom-10 hidden w-[22rem] lg:block">
                <PillarVignette slug={pillar.slug} />
              </div>
            )}
          </div>
        </div>
      </section>

      {pillar ? (
        <section aria-labelledby="see-title" className="px-4 py-24 sm:px-6">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <SectionHead id="see-title" title="What to look for in the demo" lede="Sign in as any staff role and open the page below. The data is fictional, but the checks, numbers and approvals run for real." />
              <p className="mt-6 text-[14px] text-(--mk-muted)">In the app: <code className="rounded bg-(--mk-bg-2) px-1.5 py-0.5 text-[13px]">{pillar.appHref}</code></p>
            </div>
            <ul className="flex flex-col divide-y divide-(--mk-line) border-y border-(--mk-line) lg:col-span-7">
              {pillar.points.map((t) => (
                <li key={t} className="flex gap-4 py-6 text-[17px]"><Check aria-hidden className="mt-1 size-5 shrink-0 text-(--mk-teal)" />{t}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : (
        <>
          <section aria-labelledby="run-title" className="px-4 py-24 sm:px-6">
            <div className="mx-auto max-w-7xl">
              <SectionHead id="run-title" title="What happens in a run" lede="Every run is saved step by step, so you can open any proposal and see exactly what the agent looked at." />
              <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl bg-(--mk-line) md:grid-cols-5">
                {RUN_STEPS.map(([t, b], i) => (
                  <li key={t} className="bg-white p-6">
                    <span className="text-[13px] font-medium tabular-nums text-(--mk-teal)">Step {i + 1}</span>
                    <h3 className="mt-2 text-[17px] font-semibold">{t}</h3>
                    <p className="mt-2 text-[14px] leading-relaxed text-(--mk-muted)">{b}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
          <section aria-labelledby="list-title" className="bg-(--mk-bg-2) px-4 py-24 sm:px-6">
            <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <SectionHead id="list-title" title="The eight agents" />
                <h3 className="mt-10 text-[15px] font-medium">Three levels of autonomy, set per agent</h3>
                <dl className="mt-4 flex flex-col gap-4 text-[15px]">
                  {AUTONOMY.map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-medium">{k}</dt>
                      <dd className="mt-0.5 text-(--mk-muted)">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <ul className="grid gap-px overflow-hidden rounded-2xl bg-(--mk-line) sm:grid-cols-2 lg:col-span-8">
                {AGENTS.map((a) => (
                  <li key={a.name} className="bg-white p-6">
                    <h3 className="text-[17px] font-semibold">{a.name}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-(--mk-muted)">{a.job}</p>
                    <p className="mt-4 text-[13px] font-medium text-(--mk-teal)">You approve: {a.approves.toLowerCase()}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      )}

      <section aria-labelledby="more-title" className="border-t border-(--mk-line) px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <h2 id="more-title" className="text-[22px] font-semibold tracking-[-0.02em]">More of Propniti</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...others.map((o) => [o.name, o.title, `/product/${o.slug}`, PHOTOS[o.slug]]), ...(pillar ? [["Agents", "Eight agents, and you approve money and legal decisions.", "/product/agents", PHOTOS.agents]] : [])].slice(0, 4).map(([n, t, h, img]) => (
              <Rise key={h}>
                <Link href={h} className="group block overflow-hidden rounded-2xl bg-white ring-1 ring-(--mk-line) transition-shadow duration-200 hover:shadow-md">
                  <div className="aspect-[16/9] overflow-hidden"><Photo src={img} alt="" sizes="(min-width: 1024px) 25vw, 50vw" className="transition-transform duration-500 ease-out group-hover:scale-[1.03]" /></div>
                  <div className="p-5">
                    <p className="text-[13px] font-medium text-(--mk-teal)">{n}</p>
                    <p className="mt-1.5 text-[15px] font-medium leading-snug">{t}</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-[14px] text-(--mk-muted) group-hover:text-(--mk-text)">Read more <ArrowRight aria-hidden className="size-3.5" /></span>
                  </div>
                </Link>
              </Rise>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
