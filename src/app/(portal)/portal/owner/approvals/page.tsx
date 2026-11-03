import { EmptyState } from "@/components/app/states";
import { portalCtx } from "@/extensions/owners/portal/context";
import { ownerApprovals } from "@/extensions/owners/portal/owner-data";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { ApprovalCard } from "@/extensions/owners/portal/ui/ApprovalCard";

// Repairs above the owner's approval limit: decide here; everything below the limit the team handles.
export default async function OwnerApprovals() {
  const c = await portalCtx("owner");
  if (!c) return null;
  const all = await ownerApprovals(c);
  const waiting = all.filter((a) => !a.decision);
  const decided = all.filter((a) => a.decision);
  const limit = all[0]?.limit_cents;
  return (
    <>
      <PortalTitle title="Approvals" description={`Repairs that cost more than your approval limit${limit != null ? ` of $${(limit / 100).toLocaleString("en-US")}` : ""} wait for you. Smaller repairs are handled by the property team.`} />
      <section aria-labelledby="w-h" className="space-y-3">
        <h2 id="w-h" className="text-[14px] font-semibold">Waiting for you <span className="font-normal text-muted-foreground">({waiting.length})</span></h2>
        {waiting.length ? waiting.map((a) => <ApprovalCard key={a.id} a={a} me={c.me} />) : <EmptyState kind="tasks" title="You're all caught up" description="Nothing needs your approval. We'll let you know when a repair over your limit comes in." compact />}
      </section>
      {decided.length > 0 && (
        <section aria-labelledby="d-h" className="mt-8 space-y-3">
          <h2 id="d-h" className="text-[14px] font-semibold">Decided in the last 90 days</h2>
          {decided.map((a) => <ApprovalCard key={a.id} a={a} me={c.me} />)}
        </section>
      )}
    </>
  );
}
