import { PortalShell } from "@/extensions/owners/portal/PortalShell";
import { portalCtx, row } from "@/extensions/owners/portal/context";
import { unreadCount } from "@/extensions/owners/portal/messages";

export const metadata = { title: "Resident portal · Summit Residential Partners" };

export default async function ResidentPortalLayout({ children }: { children: React.ReactNode }) {
  const c = await portalCtx("resident");
  const brand = c ? (await row<{ name: string }>(c, "SELECT p.name FROM {residents} r JOIN {properties} p ON p.id = r.property_id WHERE r.id = ?", c.me))?.name : undefined;
  const badges: Record<string, number> = c ? { "/portal/resident/messages": await unreadCount(c, "resident") } : {};
  return <PortalShell role="resident" brand={brand} badges={badges}>{children}</PortalShell>;
}
