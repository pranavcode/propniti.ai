import type { Metadata } from "next";
import { Upload } from "lucide-react";
import { currentSession } from "@/auth/session";
import { PageBody, PageHeader } from "@/components/app/page";
import { wizardOptions } from "@/extensions/import/options";
import { ImportWizard } from "@/extensions/import/ui/ImportWizard";

export const metadata: Metadata = { title: "Import data · Propniti" };

export default async function ImportPage() {
  const options = await wizardOptions(await currentSession());
  return (
    <>
      <PageHeader icon={<Upload />} title="Import data" description="Bring your portfolio over from AppFolio, Buildium, Yardi, Rent Manager, Propertyware, DoorLoop, TenantCloud, Entrata or a spreadsheet: properties, units, residents, leases, owners, vendors and open balances. Every value is checked, and nothing is written until you confirm the preview." />
      <PageBody>
        <ImportWizard options={options} />
      </PageBody>
    </>
  );
}
