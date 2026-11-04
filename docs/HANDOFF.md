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
| Live code | `main` at `a3ed973` (PR #3, the v2 rebuild), deployed 2026-11-05 |
| Database | D1 `propniti-v2` (`b9dff387-…`): migrations 0001–0007, base `2026-11-04.15` |
| Rollback | `npx wrangler rollback --name property-mgmt-ai-prototype` to the previous version. That restores the v1 code and its D1 `propniti` (`3d4ff9d5-…`), which stays untouched. |
| Preview | https://propniti-v2-preview.dnyana.workers.dev (Worker `propniti-v2-preview`). It shares D1 `propniti-v2`, and its cron is being removed so only production sweeps. |
| Scheduled agents | Cron `*/15 * * * *` through `src/worker-entry.ts`, one agent per tick. Completion on production is being verified. |
| Demo clock | "Today" is `AS_OF` = 2026-11-04 plus the Pacific time of day (`src/lib/clock.ts`). Visitor data resets at midnight Pacific. |

Last measured (preview, 2026-11-05):

| Check | Result |
|---|---|
| Unit tests | 560 / 560 |
| Lint and typecheck | Clean |
| Live AI evals | 71 / 74 (96%) |
| E2E | 43 / 45 on the previous build (both failures since fixed); re-run on production in progress |

## In flight

| Workstream | Branch / worktree | Status | Next |
|---|---|---|---|
| Auth pages in the new design (login, signup, forgot password) | `fix/auth-pages-design` in `../prototype` | Built, screenshots checked | Review → PR → merge → deploy |
| Record peek drawer: rows open a right drawer (bottom sheet on phones) | `feat/record-drawer` in `../prototype-drawer` | Building | Review → PR → merge → deploy |
| Production smoke and cron verification | — | Running | Fix anything found |
| E2E against production | `main` | Running | Fix test or app issues found |
| Handoff file | `docs/handoff` in `../prototype-handoff` | This file | PR → merge |

## Next

1. Merge and deploy the auth pages and the drawer, then smoke test production.
2. Bring the docs in line with v2:
   - the Product Spec, the Prototype Walkthrough (retake screenshots) and the `/docs` snapshot (see the notes in the research folder);
   - restyle `/docs` in the new design.
3. Approvals deep link: the public application status page should open the broker's proposal itself, not the full inbox.

## Backlog (after the demo)

- One scope-SQL helper instead of about 15 copies; route AI reads fully through `query.ts`.
- One overlay reader and upsert; one `as_of` source; shared money and date helpers.
- Dead code: about 22 unused files, 3 unused dependencies, about 118 unused exports.
- Generic edit: add the lock condition to the UPDATE guard (lock-vs-write race).
- Cron outbound-call budget: batch event claims.
- Timestamps: store true UTC plus a demo-day offset (today Pacific wall time carries a UTC label).
- Remove the v1-only helpers in `src/server/repo.ts`.
- Live-model grading for resident replies and announcements.
- Fields still editable until their named actions exist: lease status, budget approval, capex, 1099s, legal cases, service requests, message threads.

## Decisions

- **2026-11-04**
  - Per-visitor private demo data, wiped at midnight Pacific.
  - Positioning: "Know your portfolio is right."
- **2026-11-05**
  - The lease ledger is the source of truth; payments apply oldest charge first (FIFO), and stored balances must match.
  - `AS_OF` stays fixed. The app uses one demo clock instead of moving the seed date.
  - The $55 application fee goes into the property's trust account as owner income.
  - Autonomy has two levels: Approve first, Auto within policy.

## Resume here

- Check the in-flight table above and `git worktree list`.
- Running background work is listed in the orchestrator's session; if that session is gone, re-run the production smoke test and e2e (`BASE_URL=https://propniti.ai npm run e2e`).
- Cloud resources: Workers `property-mgmt-ai-prototype` (production) and `propniti-v2-preview`; D1 `propniti` (v1, rollback only) and `propniti-v2` (live).
