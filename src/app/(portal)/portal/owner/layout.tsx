import { PortalShell } from "@/extensions/owners/portal/PortalShell";
import { portalCtx } from "@/extensions/owners/portal/context";
import { unreadCount } from "@/extensions/owners/portal/messages";
import { pendingApprovals } from "@/extensions/owners/portal/owner-data";

export const metadata = { title: "Owner portal · Summit Residential Partners" };

export default async function OwnerPortalLayout({ children }: { children: React.ReactNode }) {
  const c = await portalCtx("owner");
  const badges: Record<string, number> = c ? { "/portal/owner/approvals": (await pendingApprovals(c)).length, "/portal/owner/messages": await unreadCount(c, "owner") } : {};
  return <PortalShell role="owner" badges={badges}>{children}</PortalShell>;
}
