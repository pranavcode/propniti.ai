import { PortalShell } from "@/extensions/owners/portal/PortalShell";
import { portalCtx } from "@/extensions/owners/portal/context";
import { unreadCount } from "@/extensions/owners/portal/messages";

export const metadata = { title: "Applicant portal · Summit Residential Partners" };

export default async function ApplicantPortalLayout({ children }: { children: React.ReactNode }) {
  const c = await portalCtx("applicant");
  const badges: Record<string, number> = c ? { "/portal/applicant/messages": await unreadCount(c, "applicant") } : {};
  return <PortalShell role="applicant" badges={badges}>{children}</PortalShell>;
}
