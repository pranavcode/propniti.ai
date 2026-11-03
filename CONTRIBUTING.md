# Contributing

## Setup

Requires Node.js 24.

```bash
npm install
npm run dev          # http://localhost:3000, AI on mock results, no keys needed
```

To run on the Cloudflare Workers runtime, run `npm run db:migrate:local` once, then `npm run dev:vinext`.

## Workflow

1. Branch from `main` (`git switch -c short-description`).
2. Make small, focused commits.
3. Run `npm run check` (lint, type check, tests). It must pass.
4. Push the branch and open a pull request. Fill in the template.
5. CI runs on the PR; merge when it is green and reviewed.

## Evals

Run `npm run eval` when you change anything the model sees or anything that reads its output: prompts, schemas, provider code in `src/lib/llm.ts`, the rule checks in `src/lib/mockAi.ts`, or the AI routes. Add a case in `evals/cases/` for the behaviour you changed, and put the score in the PR. The eval calls the live site (`BASE_URL`, default https://propniti.ai), so point it at a deployment that has your change. It is not part of CI; there is a manual **AI eval** workflow in GitHub Actions.

## Commit messages

Imperative, sentence case, no prefix, no trailing period. Say what changed for the user or the code:

```
Skip vacant units when reading pasted portfolio notes
Route vendor and invoice questions to computed figures
```

## Conventions

Code style, money and AI rules, tests, database changes and the definition of done are in [AGENTS.md](AGENTS.md). Security issues: see [SECURITY.md](SECURITY.md).
