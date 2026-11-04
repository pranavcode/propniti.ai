import "server-only";
import { cookies } from "next/headers";
import { Activity, Bot, CheckSquare, HeartPulse, Inbox, LayoutDashboard, LineChart, Settings, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { allEntities, can, navTree, registerPage, INTERNAL_ROLES, type Role } from "@/entities";
import { PERMISSIONS, PERSONAS, PN_AS, type Persona } from "@/auth/personas";
import { currentPersona } from "@/auth/session";
import { toursFor } from "../tour/registry";
import { SECTION_LABEL, type Density, type ShellData, type ShellPersona, type Theme } from "./types";

// Custom pages (not entity lists) in the sidebar. Entity lists come from EntityDef.nav.
const STAFF = [...INTERNAL_ROLES] as Role[];
const withModule = (m: keyof (typeof PERMISSIONS)["admin"]) => STAFF.filter((r) => (PERMISSIONS[r][m] ?? "none") !== "none");
registerPage({ key: "home.dashboard", label: "Dashboard", href: "/app", icon: LayoutDashboard, section: "home", order: 1, roles: STAFF });
registerPage({ key: "home.inbox", label: "Inbox", href: "/app/inbox", icon: Inbox, section: "home", order: 2, roles: STAFF });
registerPage({ key: "home.tasks", label: "My tasks", href: "/app/tasks", icon: CheckSquare, section: "home", order: 3, roles: STAFF });
registerPage({ key: "finance.reports", label: "Reports", href: "/app/reports", icon: LineChart, section: "finance", order: 90, roles: STAFF.filter((r) => r !== "leasing_agent") });
registerPage({ key: "ai.copilot", label: "Copilot", href: "/app/copilot", icon: Sparkles, section: "intelligence", order: 1, roles: withModule("intelligence"), ai: true });
registerPage({ key: "ai.agents", label: "Agents", href: "/app/agents", icon: Bot, section: "intelligence", order: 2, roles: withModule("intelligence"), ai: true });
registerPage({ key: "ai.approvals", label: "Approvals", href: "/app/ai/approvals", icon: ShieldCheck, section: "intelligence", order: 3, roles: withModule("intelligence"), ai: true });
registerPage({ key: "ai.activity", label: "AI activity", href: "/app/ai/activity", icon: Activity, section: "intelligence", order: 4, roles: withModule("intelligence"), ai: true });
registerPage({ key: "ai.automations", label: "Automations", href: "/app/automations", icon: Workflow, section: "intelligence", order: 5, roles: withModule("intelligence") });
registerPage({ key: "ai.data_health", label: "Data health", href: "/app/data-health", icon: HeartPulse, section: "intelligence", order: 6, roles: STAFF, ai: true });
registerPage({ key: "settings.home", label: "Settings", href: "/app/settings", icon: Settings, section: "settings", order: 1, roles: withModule("settings") });

const slim = (p: Persona): ShellPersona => ({ id: p.id, name: p.name, title: p.title, role: p.role, scopeLabel: p.scope.label, home: p.home, portal: p.portal });

// Everything the client shell needs, resolved for the current persona. `counts` keys are nav
// hrefs (e.g. "/app/inbox": 12); lane C supplies them.
export async function shellData(counts: Record<string, number> = {}): Promise<ShellData> {
  const jar = await cookies();
  const persona = await currentPersona();
  const role = persona.role;
  const ic = "size-4";

  const seen = new Set<string>();
  const nav = navTree(role).map((g) => ({
    section: g.section,
    label: SECTION_LABEL[g.section],
    items: g.items.filter((i) => !seen.has(i.href) && seen.add(i.href)).map((i) => ({
      key: i.key, label: i.label, href: i.href, group: i.group, icon: <i.icon className={ic} />, ai: i.ai,
      count: counts[i.href], countTone: (i.href === "/app/inbox" || i.href === "/app/ai/approvals" ? "attention" : "default") as "attention" | "default",
    })),
  }));

  const readable = allEntities().filter((d) => can(role, "read", d.key));
  const theme = (jar.get("pn_theme")?.value ?? "light") as Theme;
  const density = (jar.get("pn_density")?.value ?? "comfortable") as Density;

  return {
    persona: slim(persona),
    personas: PERSONAS.map(slim),
    viewingAs: jar.has(PN_AS),
    nav,
    searchEntities: readable.filter((d) => Object.values(d.fields).some((f) => f.search)).map((d) => ({ key: d.key, label: d.label.many, one: d.label.one, route: d.route, titleField: d.titleField, icon: <d.icon className={ic} /> })),
    createActions: readable.filter((d) => can(role, "create", d.key)).map((d) => ({ key: `new.${d.key}`, label: `New ${d.label.one.toLowerCase()}`, href: `${d.route}?new=1`, icon: <d.icon className={ic} /> })),
    quickActions: persona.quickActions.map((q, i) => ({ key: `quick.${i}`, label: q.label, href: q.href })),
    assistantPrompts: persona.assistantPrompts,
    tours: toursFor(role),
    theme: ["light", "dark", "system"].includes(theme) ? theme : "light",
    density: density === "compact" ? "compact" : "comfortable",
    sidebarOpen: jar.get("sidebar_state")?.value !== "false",
  };
}
