# Security review

Reviewed: 2026-11-04 · Scope: v2 (branch `v2-saas`): application code, API routes, the AI runtime, deployment configuration, dependencies.

## Summary

The app has no real accounts and moves no real money. Visitors pick a demo persona from a list. The sample portfolio is shared and read-only; each visitor's changes sit in a private overlay (Cloudflare D1, or SQLite in Docker) that is wiped at midnight Pacific time.

The main risks in v2 are:

- reads and writes outside a persona's scope;
- workflow and money rules skipped through generic edits;
- AI agents or model output acting on data;
- abuse of the public AI routes;
- leaked secrets.

Each has a control below. Issues found and fixed during the v2 build, and the remaining gaps, follow.

## Controls in place

| Area | Risk | Control | Where |
| --- | --- | --- | --- |
| Scope | Reading another region's or person's records | Every list, facet, metric and CSV export filters to the persona's properties in SQL (`scopeWhere`). Portal users (owner, resident, vendor, applicant) get only rows tied to their own record (`selfClause`); any other entity returns no rows | `src/server/query.ts`, `src/server/permissions.ts` |
| Permissions | Acting outside a role | A role × module matrix (none, read, write, approve) plus per-definition role lists; named actions list their roles; staff pages redirect portal personas to their portal | `src/auth/personas.ts`, `src/entities/registry.ts`, `src/auth/session.ts` |
| Generic writes | Writing outside scope | The scope check runs inside the write batch, so a refused create or edit writes nothing. Every reference must point at a record in scope. New ids never reuse a base or workspace id | `src/server/query.ts` (`scopeGuard`, `assertRefs`, `newId`) |
| Generic writes | Skipping a workflow step | Ledger tables (charges, payments, credits, deposits, bank accounts, bank transactions, reconciliations, journal entries, owner distributions) are actions-only (405). Fields marked `system` change only through named actions; create accepts only their initial value. `lockedWhen` refuses edits and deletes of locked records (409) | `src/entities/types.ts`, `src/server/query.ts`, `src/entities/defs/*` |
| Money | Overdraw, double payment | Each money action is one D1 batch whose first statement inserts the transfer only if the SQL guards hold; later statements run only if it exists. A unique index allows one live transfer per key, and guards also check base transfers for the key. Available trust is recomputed in SQL | `src/server/money.ts`, `src/server/data.ts` |
| Money | Approving outside one's authority | Each money action checks the role's approve right and the property scope again. Maintenance spend above the owner threshold needs the owner's recorded approval, checked in JavaScript and SQL. Work orders pay only an invoiced amount, never the editable estimate | `src/server/money.ts` |
| Money | Paying a changed bank account | No bill or work-order payout while an unverified vendor bank change is open (`NO_FRAUD_HOLD`). A bank change must be verified by someone other than the person who entered it, read from the audit log. Vendor bank details change only through the bank-change action | `src/server/money.ts`, `src/extensions/payables/actions.ts` |
| Money | Wrong deposit deductions | A disposition refuses charges that are unknown, on another lease or repeated, in JavaScript and in the guarded insert; each deduction must fit the charge's open balance | `src/server/money.ts` (`disposeDeposit`) |
| AI proposals | A stale or out-of-scope proposal running | Agents may propose only registered actions. Before an approved proposal runs, the server re-checks that the record is in the approver's scope, that its key fields match the agent's snapshot, that the action's precondition holds and that the role may run it. A guarded `ai_decisions` insert runs it once. Only staff decide proposals; an owner decides only spend waiting on them for a property they own | `src/ai/effects.ts`, `src/ai/http.ts` |
| AI tools | The model reaching data or money directly | Tool inputs are zod-checked and each tool checks the caller's role. Read tools use the scoped query layer. Write tools only create proposals or drafts, and never touch ledger tables. Drafts with amounts not in the facts are rejected | `src/ai/runtime.ts`, `src/ai/tools/*` |
| AI output | Prompt injection, invented figures | Untrusted text (documents, messages, questions, record fields) is framed as data in every prompt. Model output is schema-validated. Agent proposals must match a rules candidate, and figures come from the rules. Assistant answers with a dollar figure no tool returned fall back to rules | `src/ai/agents/framework.ts`, `src/ai/assistant.ts`, `src/lib/llm.ts` |
| AI cost | Denial of wallet | 20 AI calls a minute per IP (the `AI_RATE_LIMITER` binding, keyed on `cf-connecting-ip`), including named actions that call a model. Each agent run has a step limit, a deadline and a 50-cent budget. A sweep covers at most 10 active workspaces | `src/lib/guard.ts`, `src/app/api/e/_lib/actions.ts`, `src/ai/orchestrator.ts` |
| Cron route | Anyone starting sweeps | `/api/ai/sweep` accepts a per-isolate token set by `scheduled()`, compared in constant time, or an admin session with approve rights | `src/worker-entry.ts`, `src/ai/sweep.ts` |
| Shared data | Visitors changing the shared base | Base rows are read-only at runtime; the cookie id pattern can never equal `base`. Scheduled agents run only in visitor workspaces, and nothing auto-applies in base | `src/server/workspace.ts`, `src/ai/runtime.ts` |
| Writes | Cross-site requests | Writes need an `Origin` matching the host (403 otherwise). The workspace cookie `pn_ws` is HttpOnly, SameSite=Lax, and Secure in production | `src/app/api/e/_lib/http.ts`, `src/ai/session.ts`, `src/server/workspace.ts` |
| Writes | Request and storage abuse | 60 writes a minute per IP; bodies read as a stream and abandoned past the cap (64 KB records, 16 KB AI, 4 MB uploads); zod schemas on every body; at most 30 new workspaces per IP an hour; pages capped at 100 rows and CSV exports at 10,000 | `src/lib/guard.ts`, `src/server/workspace.ts`, `src/server/query.ts` |
| Imports | Bulk writes past role, scope or limits | Files are parsed in the browser; the server takes only cleaned records (4 MB body, zod caps per type), re-matches them to existing records, and creates only what the role may create (entity create rights; ledger records for staff who can record payments) at in-scope properties. One batch behind a unique audit lock row, so a repeat writes nothing; undo deletes only that batch's overlay rows and refuses when payments, credits, charges or work orders depend on them. The AI pass receives only headers, 5 sample rows and 30 flagged cells (60 characters each) under the AI rate limit | `src/extensions/import/server.ts`, `src/extensions/import/ai.ts`, `src/app/api/import/*` |
| Uploads | Malicious or wrong files | 4 MB cap; type decided by file signature (JPEG, PNG, WebP, PDF); anything else returns 415. Files are read in memory and discarded | `src/app/api/ai/extract/route.ts` |
| Documents | Unsafe links | Document links must be same-site or https, on write and on render | `src/entities/defs/communications.ts`, `src/components/entity/pages.tsx` |
| Output | XSS | Model and user text render as React text. The one `dangerouslySetInnerHTML` renders the repo's own docs markdown | `src/app/docs/[slug]/page.tsx` |
| Browser | Clickjacking, sniffing | In production: CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy; `X-Powered-By` removed | `next.config.ts` |
| Precompute | Writing base data from outside | `/api/ai/precompute` answers only on localhost with a token, or in dev; 404 otherwise | `src/app/api/ai/precompute/route.ts` |
| Secrets | Keys in the repo | No secrets committed; Worker secrets set with `wrangler secret put`; the placeholder `unset` counts as no key | `cloudflare.config.ts`, `src/lib/llm.ts` |
| CI | Supply chain | `npm ci`; lint, type check, tests and both builds on every push to main and every pull request | `.github/workflows/ci.yml` |

## Issues found and fixed during the v2 build

Found by lane security reviews and cross-lane requests (`research/lane-requests.md`). Each fix is in the commit named.

| Issue | Fix | Commit |
| --- | --- | --- |
| Portal users could read every row at their property, not only their own | Portal personas get only rows tied to their own record | `724fcfb` |
| Portal personas received portfolio receivables and could open staff pages | Self scope returns no portfolio receivables; staff pages send portal personas to their portal | `5590526`, `9847f7b` |
| Vendor ranking and expiring certificates drew on every property | Limited to the manager's own properties | `6090e4a` |
| Audit log, owner statements, banking and late-fee runs ignored property scope | Each now applies the reader's scope | `47987cb`, `283eb80`, `fa971a0`, `bdad40e` |
| Org-level message threads showed to property-scoped staff | Hidden from them | `569ce80` |
| A refused create or edit could still write; references could point outside scope | Scope checked inside the write batch; every reference checked | `984237c`, `ac6e947` |
| Money approvals trusted the action registry for role and scope | Role and property scope re-checked inside each money approval | `172a308` |
| Fraud-hold bypass: the wrong-lease payment fix could close any open data issue, including a vendor's unverified bank change, which lifted the payment hold | The fix closes only its own payment's issue, checked before the move and in the guarded update | `7b31164`, `9bb2f0f` |
| The person who entered a bank change could dismiss the flag and verify it | Verification reads who entered the change from the audit log; vendor bank details are read-only outside the bank-change action | `2790ac6`, `ab62741`, `3b20426`, `c671fd9` |
| Deposit dispositions accepted unknown, other-lease or repeated charges | Refused in JavaScript and in the guarded insert | `9bb2f0f` |
| Work orders could be paid from the editable estimate, or for a total other than the one reviewed | Pay only a submitted invoice, at the total the approver reviewed; over-limit jobs only after the owner's recorded approval | `0cf73e5`, `38b071d`, `67194e4` |
| Vendors could change status and estimate on their jobs, and add photos after invoicing | Vendors may accept, decline, add photos and invoice on their own jobs only; photos count only if on file before the invoice | `55bf65a`, `d2fe144` |
| Vendors could post their own insurance expiry and pass the dispatch check | Certificates start as pending verification; dispatch and ranking count only verified, unexpired ones | `a5fc28d` |
| Workflow fields (status, approvals, decisions) could be set through generic create and edit | `system` fields that only named actions set, applied in every module | `fb68d8e`, `cc2ccc8`, `c34d8be`, `b9bdb1a`, `81e68c0`, `5253fcb`, `7137e6b` |
| Approved, paid or settled records could be edited or deleted | `lockedWhen` refuses edits and deletes of bills, leases, concessions and renewal offers in locked states | `80175c1`, `1274da9`, `6b13248`, `93d22dd` |
| An approved proposal ran even if its record had changed or left scope | Approval re-checks scope, the action's precondition and the record's key fields | `3f43729` |
| Agents could propose unregistered actions; tool roles and edits were loose | Only registered actions; tool roles enforced; edits limited to message text; only shipped data rules run SQL; scope checks on AI filters and summaries | `4e1b72c`, `284ad49` |
| Anyone could decide any proposal | Only staff decide; an owner approves only spend waiting on them for a property they own | `d3688ed` |
| Named actions that call a model skipped the AI rate limit | The AI limit applies to them | `8b684be` |
| Scheduled agents could run in the shared base | Sweeps run only in active visitor workspaces | `29b1391` |
| The cron token comparison leaked timing | Constant-time compare | `2fe40d8` |
| Generic creates could reuse a base or workspace id | Ids follow the definition's format and never repeat | `95e92b4` |
| Document links accepted any scheme | Same-site or https only, on write and render | `3cf8641` |

## Dependencies

`npm audit --omit=dev` (2026-11-04): 11 findings, 9 moderate and 2 low, none high.

- **`fflate`** (through `satori` → `@vercel/og` → `vinext`): ZIP64 parsing in `unzipSync`, used by Open Graph image generation, which this app does not use.
- **`deepmerge`, `minimatch`, `ts-morph`** (through the `shadcn` package): its CLI code, used when adding components. The app imports only its stylesheet (`shadcn/tailwind.css`).

## Known gaps

From the code and from the post-demo backlog in `research/gate-checklist.md`.

- **No authentication.** Anyone can pick any persona. The persona cookie `pn_as` is not HttpOnly and is not a security boundary. Before real data: an identity provider, server-side sessions and role checks bound to the signed-in user.
- **The workspace cookie is the only key** to a visitor's changes.
- **Six AI routes have no origin check:** `/api/ai/extract`, `validate`, `import-map`, `import-parse`, `nl-filter` and `report-spec`. They are rate limited and size capped.
- **No per-org AI quota.** Limits are per IP and per run. `org_usage_monthly` holds seeded display data only.
- **Approval policies are partly enforced.** On money actions only the owner threshold for maintenance spend is enforced. Other limits, `approver_role` and `always_human` route AI proposals only. The fraud check on bill approval (not payment) runs in JavaScript, not SQL.
- **Fields still editable through generic writes** until their modules add named actions: lease status, budget status and approval, capex, 1099s, legal cases, service requests and message threads.
- **Shared rate-limit namespaces.** The preview and production Workers use the same limiter namespaces (1001, 1002).
- **AI runtime writes to base.** Cleanup of stuck runs (`reapStaleRuns`) updates and deletes some AI run rows without a workspace filter, and the sweep slot is one global `meta` row.
- **v1 routes still mounted.** `/api/state`, `/api/work-orders/*`, `/api/demo/reset` and the other v1 routes read tables that migration 0002 drops.
- **Banking scope** uses the owner entity's lowest property id. That matches "any of its properties" today only because every owner entity sits in one region.
- **`'unsafe-inline'` in the CSP**, required by hydration. Move to nonces when the runtime supports them.
- **Approximate rate limits.** Cloudflare's limiter counts per location and is eventually consistent; off Cloudflare the fallback is in memory per instance. Add a WAF rule for a hard cap.
