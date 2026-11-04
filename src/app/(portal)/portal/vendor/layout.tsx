import { PortalShell } from "@/extensions/owners/portal/PortalShell";
import { portalCtx } from "@/extensions/owners/portal/context";
import { unreadCount } from "@/extensions/owners/portal/messages";
import { jobCounts } from "@/extensions/owners/portal/vendor-data";

export const metadata = { title: "Vendor portal · Summit Residential Partners" };

export default async function VendorPortalLayout({ children }: { children: React.ReactNode }) {
  const c = await portalCtx("vendor");
  const badges: Record<string, number> = c ? { "/portal/vendor/jobs": (await jobCounts(c)).new, "/portal/vendor/messages": await unreadCount(c, "vendor") } : {};
  return <PortalShell role="vendor" badges={badges}>{children}</PortalShell>;
}
