// Plain-English definitions of property-management terms, for people new to the field. <Term>
// shows them on labels; `article` is a help_articles slug (src/seed/help*.ts) opened by "Learn more".
// Field and KPI help on entity defs wins over these where both exist; this covers everything else.

export type Help = { summary: string; article?: string };
export type GlossaryEntry = Help & { term: string; aliases?: string[] };

export const GLOSSARY: GlossaryEntry[] = [
  // Income and performance
  { term: "NOI", aliases: ["Net operating income", "NOI (last month)", "Portfolio NOI"], summary: "Net operating income: the rent and other income a property collects, minus the costs of running it. Loan payments and big capital projects are not subtracted.", article: "noi" },
  { term: "T12", aliases: ["Trailing 12 months", "Trailing 12"], summary: "The last 12 closed months added together. It smooths out seasonal swings when comparing properties." },
  { term: "Budget variance", aliases: ["Variance", "vs budget", "Variance to budget", "Over budget"], summary: "How far an actual figure landed from its budget, in dollars or percent. For income, above budget is good; for expenses, below is good.", article: "budgets-vs-actuals" },
  { term: "Budget vs actual", aliases: ["Budget vs actuals", "BvA"], summary: "Each budget line next to what was actually earned or spent, with the difference.", article: "budgets-vs-actuals" },
  { term: "Gross potential rent", aliases: ["GPR"], summary: "The rent a property would earn in a month if every unit were leased at its asking rent and everyone paid in full." },
  { term: "Market rent", summary: "What a unit would rent for today, based on comparable units nearby. It can differ from the rent on the current lease.", article: "rent-and-market" },
  { term: "Loss-to-lease", aliases: ["Loss to lease", "Rent below market"], summary: "The gap between market rent and the rent residents actually pay on current leases. It shrinks as leases renew at market.", article: "rent-and-market" },
  { term: "Concessions", aliases: ["Concession"], summary: "Discounts given to win or keep a resident, such as a free month or a waived fee. They lower the rent actually earned.", article: "approve-concessions" },
  { term: "OpEx", aliases: ["Operating expenses", "Operating expense"], summary: "Day-to-day costs of running a property: repairs, staff, utilities, insurance, taxes and management fees." },
  { term: "CapEx", aliases: ["Capital expenditure", "Capital projects"], summary: "Spending on big improvements that last for years, such as a new roof. It is tracked apart from operating expenses and does not reduce NOI.", article: "capex-projects" },

  // Occupancy and leasing
  { term: "Occupancy", aliases: ["Physical occupancy", "Physical"], summary: "Occupied and on-notice units as a share of all rentable units, counted at month end.", article: "occupancy" },
  { term: "Economic occupancy", aliases: ["Economic"], summary: "Rent actually earned as a share of gross potential rent. Vacancy, concessions and unpaid rent all pull it below physical occupancy.", article: "occupancy" },
  { term: "Vacancy loss", aliases: ["Vacancy loss MTD", "Vacancy loss this month"], summary: "Rent a property did not earn because units sat empty, at their asking rent." },
  { term: "Rent roll", aliases: ["Rent roll (leases)"], summary: "A list of every unit with its resident, lease dates, rent and balance. Owners and lenders use it as the snapshot of a property." },
  { term: "Lease abstraction", aliases: ["Lease abstract"], summary: "Pulling the key terms (dates, rent, deposits, clauses) out of a signed lease document into structured fields.", article: "lease-abstraction" },
  { term: "Renewal offer", aliases: ["Renewal offers", "Renewals"], summary: "The new rent and term offered to a resident before their lease ends.", article: "renewal-offers" },
  { term: "Make-ready", aliases: ["Make ready", "Turnover", "Turnovers", "Units not rent-ready"], summary: "The cleaning, repairs and paint that get an empty unit ready for the next resident. The time it takes is the turnover time.", article: "make-ready-turnovers" },
  { term: "Days on market", summary: "How long a unit has been listed for rent without a signed lease." },
  { term: "Screening", aliases: ["Screening flagged"], summary: "Checking an applicant's credit, income, rental history and background against the property's written criteria.", article: "screening-applicant-scores" },
  { term: "Fair housing", summary: "US laws that forbid treating applicants or residents differently because of race, religion, sex, disability, family status, national origin and other protected traits.", article: "fair-housing-applicant-scoring" },

  // Receivables
  { term: "Delinquency", aliases: ["Delinquent", "Past due", "Past-due balance"], summary: "Rent and fees residents owe after the due date has passed.", article: "delinquency" },
  { term: "Aging buckets", aliases: ["Aging", "Delinquency aging", "Payables aging", "Aging bucket"], summary: "Unpaid balances grouped by how late they are: 0–30, 31–60, 61–90 and over 90 days. Older balances are harder to collect.", article: "delinquency-aging" },
  { term: "Collections rate", summary: "Cash collected in a month as a share of rent and fees charged. Above 100% means older balances were paid down too." },
  { term: "NSF", aliases: ["Returned (NSF)", "Returned payments", "Returned payments (NSF)"], summary: "Non-sufficient funds: a payment that bounced because the payer's bank account didn't have the money. The rent is owed again.", article: "handle-nsf-returned-payment" },
  { term: "Write-off", aliases: ["Write-offs"], summary: "Removing a balance you no longer expect to collect from the books. It is recorded as bad debt.", article: "write-off-a-balance" },
  { term: "Security deposit", summary: "Money a resident pays at move-in and gets back at move-out, minus documented damage or unpaid rent.", article: "move-out-deposit-disposition" },
  { term: "Deposit disposition", aliases: ["Dispositions due"], summary: "The itemized statement, sent after move-out, of what was deducted from a security deposit and what is refunded. States set the deadline.", article: "move-out-deposit-disposition" },

  // Maintenance
  { term: "Work order", aliases: ["Work orders", "Open work orders"], summary: "A tracked repair or maintenance job: what's wrong, who's doing it, when it's due and what it cost." },
  { term: "SLA", aliases: ["Within SLA", "Past SLA", "Missed SLA", "SLA met", "SLA due", "WO SLA", "Work orders within SLA"], summary: "Service-level agreement: the deadline to finish a job, set by its priority (for example, emergencies within 24 hours)." },
  { term: "Preventive maintenance", aliases: ["Preventive", "Preventive schedule", "PM schedule"], summary: "Routine upkeep done on a schedule, such as HVAC filter changes, to prevent breakdowns. Often shortened to PM.", article: "preventive-maintenance-schedules" },
  { term: "COI", aliases: ["Vendor COI", "Vendor COIs", "Certificate of insurance"], summary: "Certificate of insurance: proof that a vendor carries liability and workers' comp insurance. Vendors without a current one shouldn't be sent work.", article: "vendor-insurance-certificates" },
  { term: "Renters insurance", summary: "A resident's own policy covering their belongings and liability. Many leases require it.", article: "renters-insurance" },

  // Accounting
  { term: "GL", aliases: ["GL account", "General ledger"], summary: "General ledger: the master list of accounts (rent income, repairs, utilities…) that every transaction is coded to.", article: "gl-recode-miscoded-bills" },
  { term: "AP", aliases: ["Accounts payable", "Open payables", "AP bill"], summary: "Accounts payable: bills the company owes vendors and hasn't paid yet.", article: "ap-inbox" },
  { term: "AR", aliases: ["Accounts receivable"], summary: "Accounts receivable: money residents and tenants owe the company, such as rent and fees." },
  { term: "PO", aliases: ["Purchase order", "Purchase orders", "PO total"], summary: "Purchase order: an approved commitment to buy something from a vendor at an agreed price, before the bill arrives." },
  { term: "1099", aliases: ["1099s", "Form 1099"], summary: "The US tax form reporting payments of $600 or more in a year to an unincorporated vendor. It needs the vendor's W-9.", article: "prepare-1099s" },
  { term: "Trust account", aliases: ["Cash in trust", "Trust accounts"], summary: "A bank account holding owners' and residents' money, kept apart from the management company's own funds as state law requires.", article: "bank-reconciliation-ai-matches" },
  { term: "Bank reconciliation", aliases: ["Reconciliation", "Reconciliations", "Unreconciled items", "Unreconciled"], summary: "Matching each bank transaction to the ledger so the books and the bank agree to the cent.", article: "bank-reconciliation-ai-matches" },
  { term: "Owner distribution", aliases: ["Owner distributions", "Distributions", "Distributed"], summary: "Money paid out to a property's owner from its trust balance, after bills, the management fee and any reserve.", article: "owner-statements-distributions" },
  { term: "Owner statement", aliases: ["Owner statements"], summary: "A monthly report to an owner showing income, expenses, fees and the distribution for their properties.", article: "owner-statements" },
  { term: "Management fee", summary: "The management company's fee, usually a percent of rent collected, taken before owner distributions." },
  { term: "Operating reserve", aliases: ["Reserve change"], summary: "Cash held back from distributions so a property can pay upcoming bills." },
  { term: "RUBS", aliases: ["RUBS method"], summary: "Ratio utility billing: splitting a building's utility bill among residents by a formula such as square feet or occupants.", article: "utility-billing-rubs" },

  // Product terms
  { term: "Approval policy", aliases: ["Approval policies"], summary: "Rules that set which actions need a person's approval and the dollar limits each role can approve.", article: "approval-policies-limits" },
  { term: "Autonomy", aliases: ["Autonomy level"], summary: "How much an agent may do on its own. Approve first: a person approves every action. Auto within policy: low-risk actions under the approval-policy limits apply on their own; the rest wait for a person.", article: "approval-policies-limits" },
  { term: "Data health", aliases: ["Data issues", "Critical data issues", "With data issues"], summary: "Checks that find bad records, such as duplicates, typos and miscoded bills, and suggest a fix you approve.", article: "data-health" },
  { term: "Proposal", aliases: ["Proposals"], summary: "An action an agent suggests, with its reasoning. Nothing happens until a person approves it or it falls inside policy.", article: "approvals-inbox-audit-log" },
  { term: "Agent run", aliases: ["Agent runs"], summary: "One pass of an AI agent over its work, with every step it took recorded so you can see why it did what it did.", article: "ai-agents-command-center" },
  { term: "AI hours saved", aliases: ["Staff hours saved by AI"], summary: "An estimate of staff time saved by agent actions people approved or that ran inside policy, using fixed minutes per action." },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const INDEX = new Map<string, GlossaryEntry>();
for (const e of GLOSSARY) for (const k of [e.term, ...(e.aliases ?? [])]) INDEX.set(norm(k), e);

// Exact match on the term or an alias, ignoring case and spacing. Plain words get nothing.
export function lookupTerm(label: string | undefined | null): GlossaryEntry | undefined {
  return label ? INDEX.get(norm(label)) : undefined;
}

// Help for a label: explicit help (a field or KPI's own) wins; the glossary fills the gaps,
// including a "Learn more" article when the explicit help has none.
export function helpFor(label: string | undefined | null, own?: Help | string | null): Help | undefined {
  const entry = lookupTerm(label);
  const mine = typeof own === "string" ? { summary: own } : own ?? undefined;
  if (!mine) return entry ? { summary: entry.summary, article: entry.article } : undefined;
  return { summary: mine.summary, article: mine.article ?? entry?.article };
}

export const helpHref = (article: string) => `/app/help/${article}`;
