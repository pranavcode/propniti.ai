// Marketing copy shared by the home page and the product pages. Every claim here maps to a
// feature in the app (route noted next to it), so the site never promises what the demo can't show.

export const DEMO_HREF = "/login";
export const BOOK_HREF = "/book-demo";

export type Pillar = {
  slug: string;
  name: string;
  title: string;
  body: string;
  points: string[];
  shot: string;           // real app screenshot in public/img/marketing/shots
  shotAlt: string;
  appHref: string;        // where the feature lives in the demo
};

export const PILLARS: Pillar[] = [
  {
    slug: "data-health",
    name: "Data you can trust",
    title: "Catch bad data before an owner or auditor does.",
    body: "Rules check leases, ledgers, vendors and contact records every night. Each problem arrives with a proposed fix, the reason for it and a confidence score. You can apply safe fixes in bulk. A person has to approve any fix that touches money or legal terms, and every fix is logged with its before and after values.",
    points: [
      "Rent keyed as $18,950 on a $1,895 lease",
      "A payment posted to the neighbor's lease",
      "Vendor bank details changed without a verification call",
    ],
    shot: "/img/marketing/shots/data-health.webp",
    shotAlt: "Data Health page: a health score for each property, open issues by severity, and a proposed fix with before and after values",
    appHref: "/app/data-health",
  },
  {
    slug: "explained",
    name: "Every number explained",
    title: "Click any number to see the rows behind it.",
    body: "Each KPI and chart opens the filtered list it was computed from. Ask why NOI fell in Atlanta and the answer is built from computed drivers: rent collected, vacancy, concessions and individual expense lines. The model writes the sentence, but every figure in it comes from your ledger.",
    points: [
      "Drill from portfolio NOI to property, month and GL line",
      "Variance notes the Owner Reporting agent offers to owners",
      "Answers show the records the assistant looked up",
    ],
    shot: "/img/marketing/shots/explained.webp",
    shotAlt: "Properties list with occupancy, NOI and delinquency KPIs; each row links to the property's ledger",
    appHref: "/app/properties",
  },
  {
    slug: "predictions",
    name: "Ahead of problems",
    title: "See the late payment, the cash shortfall and the lapsed certificate coming.",
    body: "Propniti scores each resident's delinquency risk from their payment history, projects trust-account cash 90 days ahead from bills, recurring costs and expected rent, and flags vendor insurance and permits 30 days before they expire. Each warning shows the records behind it.",
    points: [
      "Delinquency risk bands across every resident",
      "A week-by-week 90-day cash forecast per trust account",
      "Certificates of insurance and permits that expire within 30 days",
    ],
    shot: "/img/marketing/shots/predictions.webp",
    shotAlt: "Residents list with delinquency risk scores and balances, filtered to high-risk residents",
    appHref: "/app/residents",
  },
  {
    slug: "what-if",
    name: "What-if",
    title: "Test a rent or occupancy change before you commit to it.",
    body: "Move rent, occupancy or concessions for one property or a whole metro and see the NOI impact on each property next to its baseline. The simulator starts from your trailing actuals, so the starting numbers match the ledger.",
    points: [
      "Baselines from trailing 12-month actuals",
      "Per-property NOI impact, side by side",
      "A plain-English summary of the scenario you can share",
    ],
    shot: "/img/marketing/shots/what-if.webp",
    shotAlt: "What-if simulator: rent and occupancy sliders with the NOI impact for each property",
    appHref: "/app/portfolio/what-if",
  },
];

export type Agent = { name: string; job: string; approves: string };

// Jobs follow the agent goals in src/ai/agents/*.ts.
export const AGENTS: Agent[] = [
  { name: "Collections", job: "Reminds residents who are late, offers payment plans at 31 to 90 days, and refers 90+ day balances to a manager.", approves: "Late fees and payment plans" },
  { name: "Leasing", job: "Scores applications with reasons for and against, and follows up with prospects nobody has contacted in three days.", approves: "Approve, conditional or deny" },
  { name: "Renewals", job: "Drafts a renewal offer for every lease ending in 90 days, priced toward market and capped at +5%.", approves: "Every offer before it's sent" },
  { name: "Maintenance Triage", job: "Sets trade and urgency, estimates cost from past jobs, ranks vendors and checks the owner's approval limit.", approves: "Jobs over the owner limit" },
  { name: "Payables", job: "Checks each bill against the invoice, GL coding, the vendor's history and duplicates. Holds payment when bank details changed without verification.", approves: "Every bill payment" },
  { name: "Data Health", job: "Re-runs the data rules and proposes a fix for each issue, with before and after values and a confidence score.", approves: "Fixes that touch money or legal terms" },
  { name: "Owner Reporting", job: "Explains any owner NOI change of more than 3% month over month, using only computed drivers.", approves: "Notes before owners see them" },
  { name: "Compliance", job: "Requests renewals for certificates expiring within 30 days and flags vendors working with lapsed insurance.", approves: "Vendor holds" },
];

export type Persona = { key: string; who: string; title: string; body: string; points: string[]; img: string; alt: string; href: string };

export const PERSONAS_MKT: Persona[] = [
  {
    key: "operators", who: "Operators", title: "Start the day with what needs you.",
    body: "Property managers and regionals open a briefing: what the agents did overnight, what's waiting for approval, and the risks in their scope.",
    points: ["Approval queue with reasons and limits", "Work orders past SLA and leases expiring", "⌘K search and an assistant that knows the page you're on"],
    img: "/img/marketing/hero-manager.webp", alt: "Property manager reviewing the portfolio on a laptop in a leasing office", href: "/login",
  },
  {
    key: "owners", who: "Owners and investors", title: "Statements you can read line by line.",
    body: "Owners see NOI, occupancy and distributions for their own entities, open any statement line to see where it came from, and approve repairs above their limit.",
    points: ["Distributions and NOI against budget", "Explain any statement line", "Repairs over the owner limit, one tap to decide"],
    img: "/img/marketing/hero-owner.webp", alt: "Owner reviewing a property statement in a high-rise office", href: "/login",
  },
  {
    key: "residents", who: "Residents", title: "Rent, repairs and the lease, in one place.",
    body: "Residents pay rent or set up autopay, report a repair with photos and follow it to done, and read their lease without calling the office.",
    points: ["Balance, autopay and receipts", "Maintenance requests with status", "Lease documents and renewal offers"],
    img: "/img/marketing/hero-community.webp", alt: "Residents walking through an apartment community at sunset", href: "/login",
  },
  {
    key: "vendors", who: "Vendors", title: "Jobs, invoices and payments without the phone tag.",
    body: "Vendors see assigned work orders, submit invoices against the job, track payment status and keep their insurance certificate current.",
    points: ["Assigned jobs with photos and access notes", "Invoice status through to payment", "Insurance expiry reminders"],
    img: "/img/marketing/hero-maintenance.webp", alt: "Maintenance technician checking a work order on a tablet", href: "/login",
  },
];

export const INTEGRATIONS = [
  { name: "Bank feeds", note: "Daily transactions for reconciliation" },
  { name: "Plaid", note: "Resident bank verification" },
  { name: "Stripe", note: "Card and ACH rent payments" },
  { name: "Zillow", note: "Listing syndication" },
  { name: "Apartments.com", note: "Listing syndication" },
  { name: "Email and SMS", note: "Resident and vendor messages" },
  { name: "CSV import", note: "Bring rent rolls from another system" },
  { name: "GL export", note: "Journal entries for your accounting system" },
];

export const PLANS = [
  { name: "Starter", for: "Small portfolios getting off spreadsheets", points: ["Properties, leases, receivables and payables", "Resident, owner and vendor portals", "Rule-based data checks"] },
  { name: "Growth", for: "Operators with several sites and owners", points: ["Everything in Starter", "All eight agents with your approval policies", "Data Health fixes, predictions and what-if"], featured: true },
  { name: "Enterprise", for: "Multi-region operators and asset managers", points: ["Everything in Growth", "Regional scopes and custom approval limits", "Audit export and onboarding support"] },
];

export const FAQ = [
  ["Is the demo real software?", "Yes. The demo is the product, running on a sample portfolio of 30 fictional properties. Changes you make stay in your own copy of the data, and that copy resets at midnight Pacific."],
  ["Can the AI move money on its own?", "No. Agents propose payments, late fees and refunds, and a person approves them. Approval limits come from your policies, and every approval is logged with who decided and why."],
  ["Which AI models does it use?", "Workers AI by default, or Anthropic or OpenAI when you add a key. With no model available, the agents fall back to rules, and the screen says so. Every AI answer shows which of these produced it."],
  ["How do you know the numbers are right?", "Figures come from queries against the ledger, never from the model. Data Health rules check the records those figures depend on, and every KPI opens the rows it was computed from."],
  ["Can I bring data from another system?", "The import wizard reads CSV exports of rent rolls, residents and vendors, flags problems such as swapped columns, and shows you the result before anything is saved."],
  ["Who can see what?", "Each person sees only the properties in their scope, and each role has its own permissions by module. Owners, residents and vendors see only their own records."],
];
