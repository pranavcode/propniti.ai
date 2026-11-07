# Handoff

The single place to find what's live, what's in flight and what's next. Update it with every merge, deploy and decision.

## Goal

Propniti is an AI-native property-management SaaS demo at https://propniti.ai: 13 personas, 30 properties of realistic data, and AI agents that do visible, auditable work. "Done" for each change means all of these hold:

- every persona's main flows work on production;
- the e2e suite passes against production;
- live AI evals score 80% or higher;
- the docs describe only what the code does.

## How we work

- **Integration branch:** `main`, protected (pull request plus green CI, no force-push). Deploy only from `main`.
- **Workstreams:** each gets its own worktree at `../prototype-<name>` and its own branch `feat/<name>`, `fix/<name>` or `docs/<name>`. Two workstreams never edit the same files at once.
- **Review:** every branch gets a separate code and security review before merge. The implementer fixes the findings, test-first.
- **Verify:** after each deploy, note the previous version for rollback, warm up the personas' pages, and smoke test production. "Done" means verified.
- **Shared resources have one owner at a time:** the D1 databases, the preview Worker, Workers AI eval runs.
- **Secrets:** image generation uses `doppler run --project brahma --config dev`. AI provider keys are Cloudflare secrets. Never print or commit them.
- **Tooling:** npm. `npm run check` (lint, typecheck, tests) must be green before each commit.
- **Spend cap:** $10 per experiment unless agreed otherwise. Report actual spend with each result.
- **Public claims:** only measured results, with no invented customers or figures.
- **Confirm with the owner before anything destructive or outward-facing:** production config, deleting data, publishing, email.

## Live

| | Value |
|---|---|
| Production | https://propniti.ai and www, Worker `property-mgmt-ai-prototype` |
| Live code | `main` at `5aaa929` (PRs #3–#45, through batch 6 and the onboarding save fix), Worker version `3001f0b6` |
| Database | D1 `propniti-v2` (`b9dff387-…`): migrations 0001–0008, base `2026-11-04.19` (`BASE_VERSION` in `src/seed/constants.ts`) |
| Rollback | `npx wrangler rollback --name property-mgmt-ai-prototype` returns to the previous version. The v1 code and its D1 `propniti` (`3d4ff9d5-…`) stay untouched as the last resort. |
| Preview | https://propniti-v2-preview.dnyana.workers.dev (Worker `propniti-v2-preview`). It shares D1 `propniti-v2` and has no cron, so only production sweeps. |
| Scheduled agents | Cron `*/15 * * * *` through `src/worker-entry.ts`, one agent per tick, with its own slot (`ai_cron_sweep`) so page-visit sweeps can't make it skip. |
| Demo clock | "Today" is `AS_OF` = 2026-11-04 plus the Pacific time of day (`src/lib/clock.ts`). Visitor data resets at midnight Pacific. |

### Reseed (when `BASE_VERSION` changes)

Reloading the base wipes every visitor's changes. Run it right after the deploy that bumps `BASE_VERSION`.

Follow README › *Loading the sample data into D1* with `<DB>` = `propniti-v2`: `node scripts/seed-d1.mjs` writes `.seed/base.sql`, then `wrangler d1 execute … --remote --file .seed/base.sql --yes`, then `.seed/ai-precompute.sql` if it exists.

Check the printed `base_version` matches `BASE_VERSION`, then warm up and smoke test the personas' homes. The `.19` load is 518,222 rows in 1,666 statements (83 MB).

Last measured (`main` at `5aaa929`, 2026-11-04):

| Check | Result |
|---|---|
| Unit tests | 1,272 in 141 files, 1 skipped (#45) |
| Lint and typecheck | Clean |
| Live AI evals | 74 / 86 (86%) on Workers AI, local server, before the onboarding detection fix; the 5 onboarding detection cases then passed 5 / 5 on their own. Full suite not re-run since |
| E2E | 190 tests in 34 specs; production run of the touched suites 74 / 74 after #45 |

## Shipped

Shipped 2026-11-04 after batch 4:

| PR | What |
|---|---|
| #40 | Copilot chat fits the screen at desktop, tablet and phone sizes; one main landmark per page |
| #41 | 28 sample Copilot conversations across staff and portal personas, marked *Sample* (`BASE_VERSION` `.18`) |
| #43 | Batch 5: guided setup at `/app/onboarding` (company, data with rules-first and optional AI file detection, suggested approval limits and autonomy, team, Data Health check and summary); the principal can invite people but not grant admin; CSV, Excel and PDF downloads with optional branding on lists, reports and owner statements; action feedback (top progress bar, filter summaries, toasts, stronger chat tips) |
| #44 | Batch 6, about 30 UX audit fixes: names instead of ids, readable dates, readable Data Health with manual next steps, one past-due definition, scoped counts, no phone overflow, KPI tiles, the Agents page in plain words, tab clicks, table edge shades, import tool tiles with *Try samples* per tool, no dead-end sidebar links, persona homes in the sidebar, tour offers that never cover tables, portal dark mode and OS theme, AI onboarding detection fix (0/5 → 5/5) (`BASE_VERSION` `.19`) |
| #45 | Onboarding saves run one at a time, so the summary no longer loses a saved approval limit |

Earlier on 2026-11-04, in four batches after the morning PRs (#3–#11):

| Batch | PR | What |
|---|---|---|
| — | #13, #14, #15, #18, #20, #22, #24 | Data Health and action-route approval checks with D1 error masking; AI quality fixes; Inbox; performance (hover prefetch, indexes, migration 0008); new logo; app height fix |
| 1 | #28, #29 | Demo email and password sign-in; import from AppFolio, Buildium, Yardi and more with optional AI; *Ask Propniti* chat bubble; My tasks; Automations; sparkle marks; clickable breadcrumbs; crawl fixes; thin scrollbars and growing chat inputs |
| 2 | #30 | Row alignment, collapsible home sections and *Reset layout*, readable run steps, *Summarize with AI*, e2e fixes |
| 3 | #31 | Chat history, *Ask about this*, Do mode starts agents, *Right now*; welcome splash, tour toasts, new-feature dots, daily panel auto-open; approvals, bulk, leasing, money and operations friction fixes; one decide rule with life-safety approvals by regional manager or principal; collection rate per month's charges; Title Case agent names |
| 4 | #32 | *Improve with AI* on red KPIs; glossary definitions on labels and `/app/help/<id>` pages; KPI and chart card layout; compact *Pick a person* sign-in; docs restyle and v2 content; updated help articles (base `2026-11-04.17`) |

## In flight

| Workstream | Branch / worktree | Status | Next |
|---|---|---|---|
| Docs after batches 5 and 6 | `docs/batch-5-6` in `../prototype-docs56` | Docs, HANDOFF and screenshots refreshed from production; not pushed | Review → merge |

## Next

1. Merge `docs/batch-5-6`, then sync the three Claude Docs (Product Spec, Prototype Walkthrough, Architecture) from `content/docs/*.md`.
2. Re-run the full live AI eval (`npm run eval`) on the current code; the last full run predates the onboarding detection fix.
3. Re-run `scripts/ai-precompute.mjs` so stored property summaries carry the new facts keys.
4. Owner decisions pending:
   - Should the broker desk also list scored applications still at Submitted?
   - Should vendor issues in Data Health show to property-scoped roles? Today they are hidden from them.
   - Should *Settings › Company profile* stay admin-only, or open to the principal (who can already run guided setup)?

## Open items from batches 5 and 6

- **Stale Active leases.** 87 leases are still *Active* past their end date. Add a Data Health rule for them.
- **Stored seed reason text.** Some seeded reasons read like code: "for 9270.58" (raw money) and "term_months" (a raw key). Fix the generator wording and bump `BASE_VERSION`.
- **Dates.** A few KPI tiles and report subtitles still show "2026-11-04" (Residents *Past due today*, AR aging "as of").
- **Agent schedules.** The seeded agent settings override the code defaults (for example Leasing every 30 minutes vs every 4 hours in code, Renewals Mondays 15:00 vs 13:00). Pick one source.
- ***Improve with AI* lock.** The one-plan-at-a-time lock doesn't hold across scopes yet.
- **Short AI timeouts.** Some AI calls give up early and fall back to rules; review the timeouts.
- **Vendor deactivation** is not covered by the life-safety approval rule.
- **E2E residue.** The e2e run leaves one invited person in its own workspace (cleared at midnight Pacific).

## Backlog (after the demo)

- One scope-SQL helper instead of about 15 copies; route AI reads fully through `query.ts`.
- One overlay reader and upsert; one `as_of` source; shared money and date helpers.
- Dead code: about 22 unused files, 3 unused dependencies, about 118 unused exports.
- Generic edit: add the lock condition to the UPDATE guard (lock-vs-write race).
- Cron outbound-call budget: batch event claims.
- Timestamps: store true UTC plus a demo-day offset (today Pacific wall time carries a UTC label).
- Remove the v1-only helpers in `src/server/repo.ts`.
- Live-model grading for resident replies and announcements.
- Summary facts: generic rules sentence prints raw money (e.g. "estimate: 1200"); `units.open_work_orders` counts all orders and caps at 25; `summaries.ts` swallows DB errors as "no summary".
- Peek drawer: debounce J key-repeat fetches; put row-id attributes on `<tr>` so a hidden title column doesn't break J/K; Edit sheet Cancel reloads the drawer.
- Approvals inbox: `?agent=` filter hint shows while a deep link ignores it; paging keeps `?proposal=` in the URL.
- A first-visit product tour opens over a `?peek=` deep link.
- Import: `import.completed` waits for the next sweep; `/api/ai/events` could drain it right away. The stale comment in `src/app/api/ai/events/route.ts` says the wizard writes through the entity API.
- Five agent events have no source yet: `coi.expiring`, `prospect.created`, `screening.completed`, `statement.closed`, `data_issue.detected`.
- Fields still editable until their named actions exist: lease status, budget approval, capex, 1099s, legal cases, service requests, message threads.

## Decisions

- **2026-11-04**
  - Per-visitor private demo data, wiped at midnight Pacific.
  - Positioning: "Know your portfolio is right."
- **2026-11-05**
  - Adopted the orchestrator workflow: a worktree per workstream, independent review before merge, deploy only from `main`.
  - The lease ledger is the source of truth; payments apply oldest charge first (FIFO), and stored balances must match.
  - `AS_OF` stays fixed. The app uses one demo clock instead of moving the seed date.
  - The $55 application fee goes into the property's trust account as owner income.
  - Autonomy has two levels: Approve first, Auto within policy.
- **2026-11-07**
  - Production Worker answers only on its custom domains: `workersDev: false` in `cloudflare.config.ts` (the workers.dev host skipped the HTTPS redirect and zone rules). Takes effect on the next deploy.

## Resume here

- Check the in-flight table above and `git worktree list`.
- Running background work is listed in the orchestrator's session; if that session is gone, re-run the production smoke test and e2e (`BASE_URL=https://propniti.ai npm run e2e`).
- Cloud resources: Workers `property-mgmt-ai-prototype` (production) and `propniti-v2-preview`; D1 `propniti` (v1, rollback only) and `propniti-v2` (live).
