import { FileText, ShieldAlert, ShieldCheck } from "lucide-react";
import { Money, StatusBadge } from "@/components/app/display";
import { portalCtx } from "@/extensions/owners/portal/context";
import { currentLease, daysUntil, documents, insurance, me, offers, parsePhotos } from "@/extensions/owners/portal/resident-data";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { RenewalOffers } from "@/extensions/owners/portal/ui/resident/RenewalOffers";
import { Card, fmtDay } from "@/extensions/owners/portal/ui/resident/bits";

// Same-site paths and https links only (documents can be imported from elsewhere).
const safe = (u: string) => (u.startsWith("/") && !u.startsWith("//")) || u.startsWith("https://") ? u : undefined;

export default async function ResidentLease() {
  const c = await portalCtx("resident");
  if (!c) return null;
  const r = await me(c);
  if (!r) return null;
  const lease = await currentLease(c, r.household_id);
  if (!lease) {
    return (
      <>
        <PortalTitle title="Your lease" />
        <p className="rounded-xl border bg-card px-4 py-10 text-center text-[13px] text-muted-foreground">We couldn&apos;t find an active lease for you. Message the office if this looks wrong.</p>
      </>
    );
  }
  const [offerList, policy, docs] = await Promise.all([offers(c, lease.id), insurance(c, lease.id), documents(c, lease.id)]);
  const unitPhotos = parsePhotos(lease.unit_photos);
  const photos = (unitPhotos.length ? unitPhotos : parsePhotos(lease.photos)).slice(0, 4);
  const left = lease.end_on ? daysUntil(lease.end_on) : null;
  const facts: [string, React.ReactNode][] = [
    ["Apartment", `#${lease.unit}${lease.beds != null ? ` · ${lease.beds} bed, ${lease.baths ?? "—"} bath` : ""}${lease.sqft ? ` · ${lease.sqft.toLocaleString("en-US")} sq ft` : ""}`],
    ["Monthly rent", <Money key="r" value={lease.rent_cents} cents tone="none" />],
    ["Security deposit", <Money key="d" value={lease.deposit_cents} cents tone="none" />],
    ["Term", lease.term_months ? `${lease.term_months} months` : "Month-to-month"],
    ["Starts", fmtDay(lease.start_on, true)],
    ["Ends", lease.end_on ? `${fmtDay(lease.end_on, true)}${left != null && left >= 0 ? ` (${left} days)` : ""}` : "—"],
  ];
  return (
    <>
      <PortalTitle title="Your lease" eyebrow={`${lease.property} · ${lease.street}, ${lease.city}, ${lease.state} ${lease.zip}`} description={`Lease ${lease.id}`} />
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card title="Lease details" action={<StatusBadge value={lease.status} />}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-3">
              {facts.map(([k, v]) => <div key={k}><dt className="text-[11.5px] text-muted-foreground">{k}</dt><dd className="mt-0.5 font-medium tabular-nums">{v}</dd></div>)}
            </dl>
          </Card>

          <div id="renewal" className="scroll-mt-20">
            <Card title="Renewal">
              {offerList.length ? <RenewalOffers me={c.me} offers={offerList} /> : (
                <p className="text-[13px] text-muted-foreground">No renewal offer yet. The office usually sends one 60 to 90 days before your lease ends{lease.end_on ? ` (${fmtDay(lease.end_on, true)})` : ""}. You&apos;ll see it here and get a message.</p>
              )}
            </Card>
          </div>

          <Card title="Documents">
            {docs.length ? (
              <ul className="divide-y">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2.5">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      {safe(d.url) ? <a href={safe(d.url)} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium hover:text-primary hover:underline">{d.name}</a> : <p className="truncate text-[13px] font-medium">{d.name}</p>}
                      <p className="text-[11.5px] text-muted-foreground">{d.doc_type ?? "Document"} · {fmtDay(d.uploaded_at, true)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-muted-foreground">Your signed lease, move-in inspection and community rules will appear here once they&apos;re filed.</p>}
          </Card>
        </div>

        <div className="space-y-4">
          {photos.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- static webp in /public */}
              {photos.map((p, i) => <img key={p} src={p.replace(/\.webp$/, "-400.webp")} alt={`Apartment ${lease.unit}, photo ${i + 1}`} className="aspect-[4/3] w-full rounded-lg object-cover ring-1 ring-border" loading="lazy" />)}
            </div>
          )}
          <div id="insurance" className="scroll-mt-20">
            <Card title="Renters insurance" action={policy ? <StatusBadge value={policy.status} tone={policy.status === "Active" ? "success" : policy.status === "Lapsed" ? "danger" : "warning"} /> : <StatusBadge value="Missing" tone="warning" label="None on file" />}>
              {policy ? (
                <div className="space-y-3 text-[13px]">
                  <div className="flex items-start gap-2">
                    {daysUntil(policy.expires_on) <= 30 ? <ShieldAlert className="mt-0.5 size-4 shrink-0 text-tone-warning" /> : <ShieldCheck className="mt-0.5 size-4 shrink-0 text-tone-success" />}
                    <p>{policy.carrier}, policy {policy.policy_number}</p>
                  </div>
                  <dl className="grid grid-cols-2 gap-2">
                    <div><dt className="text-[11.5px] text-muted-foreground">Liability</dt><dd className="font-medium"><Money value={policy.liability_cents} cents style="whole" tone="none" /></dd></div>
                    <div><dt className="text-[11.5px] text-muted-foreground">Expires</dt><dd className="font-medium tabular-nums">{fmtDay(policy.expires_on, true)}</dd></div>
                  </dl>
                  {daysUntil(policy.expires_on) <= 30 && <p className="rounded-lg bg-tone-warning/10 px-3 py-2 text-[12.5px]">{daysUntil(policy.expires_on) < 0 ? "This policy has expired." : `Expires in ${daysUntil(policy.expires_on)} days.`} Message the office to find out how to send your renewal declarations page.</p>}
                </div>
              ) : <p className="text-[13px] text-muted-foreground">Your lease requires renters insurance. Message the office and they&apos;ll tell you how to send your declarations page.</p>}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
