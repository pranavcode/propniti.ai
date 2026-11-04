import { PERMISSIONS } from "@/auth/personas";
import type { Role } from "@/entities/types";

// Settings sub-navigation. Org sections need settings access (admin edits, leaders read);
// personal sections are for every staff role; platform sections are for the SaaS operator.

export type SettingsLink = { href: string; label: string; icon: string };
export type SettingsGroup = { label: string; items: SettingsLink[] };

export const canSettings = (role: Role) => (PERMISSIONS[role].settings ?? "none") !== "none";
export const canEditSettings = (role: Role) => PERMISSIONS[role].settings === "approve";

export function settingsNav(role: Role): SettingsGroup[] {
  const groups: SettingsGroup[] = [];
  if (canSettings(role)) {
    groups.push(
      { label: "Organization", items: [
        { href: "/app/settings/company", label: "Company profile", icon: "building" },
        { href: "/app/settings/users", label: "Users", icon: "users" },
        { href: "/app/settings/roles", label: "Roles and permissions", icon: "key" },
        { href: "/app/settings/integrations", label: "Integrations", icon: "plug" },
        { href: "/app/settings/import", label: "Import data", icon: "upload" },
      ] },
      { label: "Policies", items: [
        { href: "/app/settings/approvals", label: "Approval policies", icon: "shield" },
        { href: "/app/settings/state-rules", label: "State rules", icon: "landmark" },
        { href: "/app/settings/payments", label: "Fees and payments", icon: "percent" },
        { href: "/app/automations", label: "Automations", icon: "workflow" },
      ] },
      { label: "AI and governance", items: [
        { href: "/app/settings/ai", label: "AI settings", icon: "sparkles" },
        { href: "/app/settings/audit", label: "Audit log", icon: "history" },
      ] },
    );
  }
  groups.push({ label: "Personal", items: [{ href: "/app/settings/notifications", label: "Notifications", icon: "bell" }] });
  if (role === "platform_admin") {
    groups.push({ label: "Platform", items: [
      { href: "/app/settings/platform", label: "Customer orgs", icon: "globe" },
      { href: "/app/settings/platform/usage", label: "Usage and cost", icon: "gauge" },
      { href: "/app/settings/platform/health", label: "System health", icon: "activity" },
    ] });
  }
  return groups;
}
