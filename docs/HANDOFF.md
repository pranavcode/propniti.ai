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
| Live code | `main` at `e83c5aa` (PRs #3–#9), Worker version `ef53be4e`, deployed 2026-11-04 03:50 UTC |
| Database | D1 `propniti-v2` (`b9dff387-…`): migrations 0001–0007, base `2026-11-04.15` |
| Rollback | `npx wrangler rollback --name property-mgmt-ai-prototype` returns to the previous version (`c15fe668`). The v1 code and its D1 `propniti` (`3d4ff9d5-…`) stay untouched as the last resort. |
| Preview | https://propniti-v2-preview.dnyana.workers.dev (Worker `propniti-v2-preview`). It shares D1 `propniti-v2` and has no cron, so only production sweeps. |
| Scheduled agents | Cron `*/15 * * * *` through `src/worker-entry.ts`, one agent per tick, with its own slot (`ai_cron_sweep`) so page-visit sweeps can't make it skip. Verified on production: the 03:15, 03:30 and 03:45 UTC ticks each ran an agent. |
| Demo clock | "Today" is `AS_OF` = 2026-11-04 plus the Pacific time of day (`src/lib/clock.ts`). Visitor data resets at midnight Pacific. |

Last measured (production `ef53be4e`, 2026-11-04):

| Check | Result |
|---|---|
| Unit tests | 580 / 580 |
| Lint and typecheck | Clean |
| Live AI evals | 71 / 74 (96%) on the preview; not re-run since (no model-prompt changes) |
| E2E against production | 47 / 47 (43 on the first run; 4 specs updated for the peek drawer, then passed) |

## In flight

| Workstream | Branch / worktree | Status | Next |
|---|---|---|---|
| Handoff update | `docs/handoff-update` in `../prototype-handoff` | This file | PR → merge |

Shipped 2026-11-04: e2e specs updated for the drawer (this PR), auth pages in the new design (#5), record peek drawer (#7), cron slot fix (#6), approvals deep link (#8), AI summaries from current figures (#9). Each had an independent review; production e2e and smoke tests passed after deploy.

## Next

1. Owner decisions pending: property "NOI (month)" shows November to date (a full month of rent against a few days of expenses); show October, the last full month? And should the broker desk table also list scored applications still at Submitted?
2. Bring the docs in line with v2:
   - the Product Spec, the Prototype Walkthrough (retake screenshots) and the `/docs` snapshot (see the notes in the research folder);
   - restyle `/docs` in the new design.
3. Re-run `scripts/ai-precompute.mjs` so stored property summaries carry the new facts keys (until then every property shows the rules summary, which is accurate). Optionally drop the old seed summary rows (bump `BASE_VERSION`, re-seed; resets visitor workspaces).

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

## Resume here

- Check the in-flight table above and `git worktree list`.
- Running background work is listed in the orchestrator's session; if that session is gone, re-run the production smoke test and e2e (`BASE_URL=https://propniti.ai npm run e2e`).
- Cloud resources: Workers `property-mgmt-ai-prototype` (production) and `propniti-v2-preview`; D1 `propniti` (v1, rollback only) and `propniti-v2` (live).
