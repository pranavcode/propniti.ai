// "What can I do here?" for the assistant panel: a two-line explanation of the current page,
// links onward, and suggested questions for this page ahead of the persona's own.

export type GuideLink = { label: string; href: string };
export type PageGuide = { title: string; about: string; links: GuideLink[]; prompts: string[] };
type NavLite = { label: string; href: string; help?: string };
type Rule = { match: RegExp; title?: string; about?: string; links?: GuideLink[]; prompts: string[] };

const HELP: GuideLink = { label: "Help center", href: "/docs" };

const RULES: Rule[] = [
  {
    match: /^\/app$/, title: "Dashboard",
    about: "Your portfolio's KPIs, briefing and charts for the last closed month. Select a number for the rows behind it, or Explain to see why it moved.",
    links: [{ label: "Properties", href: "/app/properties" }, { label: "Reports", href: "/app/reports" }],
    prompts: ["Why did NOI change last month?", "Where is delinquency rising fastest?"],
  },
  {
    match: /^\/app\/today$/, title: "Today",
    about: "Your day across your properties: the briefing, conversations waiting, agent proposals to decide and leases ending without a renewal. Each item opens its record.",
    links: [{ label: "Approvals", href: "/app/ai/approvals" }, { label: "Inbox", href: "/app/inbox" }],
    prompts: ["Who is late on rent?", "What needs my approval today?"],
  },
  {
    match: /^\/app\/finance$/, title: "Finance",
    about: "Payables and cash at a glance: aging, income against expense, budget against actual, a 90-day cash forecast and the proposals waiting for your decision.",
    links: [{ label: "Approvals", href: "/app/ai/approvals" }, { label: "Data health", href: "/app/data-health" }],
    prompts: ["Which bills look unusual this month?", "What is unreconciled in the trust accounts?"],
  },
  {
    match: /^\/app\/ai\/approvals$/, title: "Approvals",
    about: "What the AI agents proposed and stopped on. Each item shows its reasons, risk and the run that produced it; approving runs the action once and records who approved it.",
    links: [{ label: "AI activity", href: "/app/ai/activity" }, { label: "Agents", href: "/app/agents" }],
    prompts: ["What needs my approval today?", "Which approvals are high risk?"],
  },
  {
    match: /^\/app\/data-health$/, title: "Data health",
    about: "Rules check the records money decisions depend on. Each problem comes with a fix, its reasons and a confidence; money, fraud and legal fixes wait for a person.",
    links: [{ label: "Critical issues", href: "/app/data-health?severity=critical" }],
    prompts: ["Which data issues affect money?", "How is the data health score computed?"],
  },
  {
    match: /^\/app\/receivables\/collections$/, title: "Collections",
    about: "Delinquent residents ranked by risk, with the reasons and the Collections Agent's next step. Low-risk reminders can be approved together; plans and legal referrals one at a time.",
    links: [{ label: "High risk first", href: "/app/receivables/collections?band=High" }, { label: "Delinquency aging", href: "/app/receivables/delinquency" }],
    prompts: ["Who is 30+ days late on rent?", "What changed in delinquency since last month?"],
  },
  {
    match: /^\/app\/receivables\/delinquency$/, title: "Delinquency aging",
    about: "Past-due balances by property and days late; each charge ages from its own due date. Select a cell for the residents in it, or a total for the charges behind it.",
    links: [{ label: "Collections", href: "/app/receivables/collections" }],
    prompts: ["Who is 30+ days late on rent?", "Where is delinquency rising fastest?"],
  },
  {
    match: /^\/app\/properties\/[^/]+$/,
    about: "One property with its details, related records and activity. Questions you ask here are about this property.",
    links: [{ label: "All properties", href: "/app/properties" }],
    prompts: ["Why did NOI change at this property?", "Which units are vacant here?", "Who is late on rent here?"],
  },
  { match: /^\/app\/properties$/, prompts: ["Which properties are below budget NOI this quarter?", "Rank my properties by economic occupancy"] },
  { match: /^\/app\/receivables(\/|$)/, prompts: ["Who is late on rent?", "What changed in delinquency since last month?"] },
  { match: /^\/app\/maintenance(\/|$)/, prompts: ["Which work orders will breach SLA today?", "How many units are not rent-ready?"] },
  { match: /^\/app\/leases(\/|$)/, prompts: ["Which leases expire next month without a renewal offer?"] },
  { match: /^\/app\/leasing(\/|$)/, prompts: ["Which prospects haven't heard from us in 3 days?", "What 2-bed units are available before the 15th?"] },
  { match: /^\/app\/(payables|banking|finance)(\/|$)/, prompts: ["Which bills look unusual this month?", "Which vendors changed bank details recently?"] },
];

// The nav item the page belongs to: the longest href that is the path or a parent of it.
function navItem(path: string, nav: NavLite[]) {
  return nav.filter((n) => path === n.href || (n.href !== "/app" && path.startsWith(n.href + "/"))).sort((a, b) => b.href.length - a.href.length)[0];
}

export function pageGuide(path: string, ctx: { nav: NavLite[]; personaPrompts: string[] }): PageGuide {
  const rule = RULES.find((r) => r.match.test(path));
  const item = navItem(path, ctx.nav);
  const record = !!item && path !== item.href;
  const title = rule?.title ?? (item ? (record ? `${item.label}: one record` : item.label) : "This page");
  const about = rule?.about ?? (record
    ? "One record with its details, related records and activity. Questions you ask here are about this record."
    : item?.help ?? "Ask how anything on this page works, or what it shows for your properties.");
  // Links go to pages the persona has: in their nav, or beside the page they're on.
  const parent = path.slice(0, path.lastIndexOf("/") + 1);
  const allowed = (href: string) => href.startsWith("/docs") || !!navItem(href.split("?")[0], ctx.nav) || (parent.length > "/app/".length && href.startsWith(parent));
  const links = [...(rule?.links ?? (record && item ? [{ label: `All ${item.label.toLowerCase()}`, href: item.href }] : [])), HELP].filter((l) => allowed(l.href));
  const prompts = [...new Set([...(rule?.prompts ?? []), ...ctx.personaPrompts])].slice(0, 4);
  return { title, about, links, prompts };
}
