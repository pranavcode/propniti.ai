"use client";

import { AISummaryCard, ApprovalItem, FixPreview } from "@/components/app/ai";
import { KpiCard } from "@/components/app/dashboard";
import { TooltipProvider } from "@/components/ui/tooltip";

// Small pieces of the real app UI (Lane B components with sample values), laid over the pillar
// screenshots. They render inside data-surface="app" so they pick up the app's own tokens.
const noop = async () => {};
const ago = (min: number) => new Date(Date.UTC(2026, 10, 4, 14, 0) - min * 60_000).toISOString();

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="app" className="rounded-lg bg-transparent text-left [&_a]:pointer-events-none [&_button]:pointer-events-none" aria-hidden>
      <TooltipProvider>{children}</TooltipProvider>
    </div>
  );
}

export function PillarVignette({ slug }: { slug: string }) {
  if (slug === "data-health")
    return (
      <Surface>
        <FixPreview
          className="shadow-lg"
          title="Lease rent looks like a typo"
          rule="leases.rent_outlier"
          changes={[{ field: "rent", label: "Monthly rent", before: "$18,950.00", after: "$1,895.00" }]}
          why={["Market rent for the unit is $1,880", "The last 3 charges posted at $1,895.00"]}
          confidence={0.97}
          source="Data Health Agent"
          onApply={noop}
          onDismiss={noop}
        />
      </Surface>
    );
  if (slug === "explained")
    return (
      <Surface>
        <AISummaryCard
          className="shadow-lg"
          title="Why NOI moved in Atlanta"
          bullets={["Concessions on 11 move-ins at Grant Park Commons", "Two roof repairs at Decatur Square Townhomes", "Collections steady at 98.7% of charges"]}
          generatedAt={ago(40)}
          source="precomputed"
        />
      </Surface>
    );
  if (slug === "predictions")
    return (
      <Surface>
        <ApprovalItem
          className="shadow-lg"
          agent="Renewals Agent"
          title="Renewal offer for unit 208"
          amount={1945}
          risk="Low"
          why={["Comparable 1-beds leased at $1,960 to $2,010 in the last 60 days", "Paid on time for 26 months; delinquency risk score 12"]}
          confidence={0.81}
          policy="Rent change under +5% · property manager approves"
          createdAt={ago(95)}
          onApprove={noop}
          onReject={noop}
        />
      </Surface>
    );
  if (slug === "what-if")
    return (
      <Surface>
        <KpiCard className="w-64 shadow-lg" label="Scenario NOI, Phoenix" value={412_600} previous={398_200} format="money" deltaLabel="vs baseline" spark={[371, 380, 384, 390, 396, 398, 405, 412]} />
      </Surface>
    );
  return null;
}
