import { can } from "@/entities";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { PageBody, PageHeader } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { getRow } from "@/server/query";
import { SAMPLE_PHOTOS } from "@/extensions/maintenance/actions";
import { intakeOptions } from "@/extensions/maintenance/queries";
import { PHOTO_TAGS, photoTag } from "@/extensions/maintenance/rules";
import { IntakeForm } from "@/extensions/maintenance/ui/Intake";

export const metadata = { title: "New maintenance request · Propniti" };

const EXAMPLES = [
  "AC is blowing warm air and the thermostat says 84. Resident has a newborn.",
  "Water leaking under the kitchen sink, cabinet floor is soaked.",
  "Breaker for the bedroom keeps tripping and there's a burning smell near the outlet.",
  "Vehicle gate at the north entrance won't close.",
];

export default async function IntakePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 80) : undefined);
  const { actor, ws } = await currentSession();
  if (!can(actor.role, "create", "work_orders")) {
    return <main className="p-6"><EmptyState title="You can't log maintenance requests in this role" description="Switch to the maintenance supervisor or a property manager from your avatar menu." action={{ label: "Back to maintenance", href: "/app/maintenance" }} /></main>;
  }
  const properties = await intakeOptions(getPlatform().db, ws, actor);
  const property = one(sp.property);
  const unitId = one(sp.unit);
  const unit = unitId ? await getRow({ db: getPlatform().db, ws, actor }, "units", unitId).catch(() => null) : null;
  return (
    <main>
      <PageHeader title="New maintenance request" description="Describe the problem in plain words and add a photo. The Maintenance Triage agent suggests the trade, urgency, an estimate and the best vendor. Under your auto-approve limit it assigns that vendor itself; above it, you choose." />
      <PageBody>
        {properties.length
          ? <IntakeForm properties={properties} photos={SAMPLE_PHOTOS.map((url) => ({ url, label: PHOTO_TAGS[photoTag(url)!].label }))} examples={EXAMPLES} initial={{ property, unit: unit && unit.property_id === property ? { id: unitId!, label: String(unit._title ?? unitId) } : undefined }} />
          : <EmptyState title="No properties in your scope" description="Requests are logged against a property you manage." />}
      </PageBody>
    </main>
  );
}
